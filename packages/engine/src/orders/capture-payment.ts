/**
 * captureSquarePayment is the back half for card tenders: Square order +
 * payment carrying app_fee_money, paid event, platform_fees row, loyalty
 * earn. Split from placement so a checkout that dies between the two never
 * strands money — the order just stays 'created' until capture succeeds or
 * the webhook advances it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { FeeConfig } from '../fees';
import { createSquareOrder, createSquarePayment, type SquareConfig } from '../square/client';

import type { SnapshotLine } from './internal';
import { appFeeForCharge, insertPlatformFeeOnce } from './platform-fees';
import { buildSquareLines } from './square-lines';
import { OrderError } from './types';

export type CapturePaymentDeps = {
  db: SupabaseClient;
  square: SquareConfig;
  locationAccessToken: string;
  squareLocationId: string;
  feeConfig: FeeConfig;
  locationTimezone: string;
};

export type CapturePaymentInput = {
  orderId: string;
  /** Card token from the app's payment SDK. */
  sourceId: string;
};

export async function captureSquarePayment(
  deps: CapturePaymentDeps,
  input: CapturePaymentInput,
): Promise<{ orderId: string; squarePaymentId: string }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, location_id, customer_id, status, totals, subtotal_cents, tip_cents, total_cents, stored_value_applied_cents, square_payment_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      location_id: string;
      customer_id: string | null;
      status: string;
      totals: { lines?: SnapshotLine[] } & Record<string, unknown>;
      subtotal_cents: number;
      tip_cents: number;
      total_cents: number;
      stored_value_applied_cents: number;
      square_payment_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');
  // A retried capture after a lost response must finish the local settlement,
  // not merely notice that Square already charged the card. Linking the
  // payment, recording platform revenue, and appending the paid event are
  // separate database calls because the external charge sits between them.
  // Square's idempotency keys prevent another charge; these local idempotent
  // repairs prevent a linked-but-unpaid order replaying as a false success.
  if (order.square_payment_id) {
    const cardChargeCents = order.total_cents - order.stored_value_applied_cents;
    const fee = await appFeeForCharge(deps.db, {
      locationId: order.location_id,
      chargeCents: cardChargeCents,
      feeConfig: deps.feeConfig,
      locationTimezone: deps.locationTimezone,
    });
    await insertPlatformFeeOnce(deps.db, {
      brand_id: order.brand_id,
      location_id: order.location_id,
      order_id: order.id,
      gross_cents: cardChargeCents,
      fee_cents: fee.feeCents,
      fee_bps_applied: fee.feeBpsApplied,
      square_payment_id: order.square_payment_id,
    });
    if (order.status === 'created') {
      const { error } = await deps.db.from('order_events').insert({
        brand_id: order.brand_id,
        order_id: order.id,
        type: 'paid',
        snapshot: {
          ...order.totals,
          square_payment_id: order.square_payment_id,
          card_charge_cents: cardChargeCents,
          recovered: true,
        },
        source: 'system',
      });
      if (error) throw error;
    }
    return { orderId: order.id, squarePaymentId: order.square_payment_id };
  }
  if (order.status !== 'created') {
    throw new OrderError('invalid_request', `Order is ${order.status}; only a created order can be captured.`);
  }

  const lines = (order.totals.lines ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    options: line.options ?? [],
    packContents: line.pack_contents ?? [],
  }));
  const squareOrder = await createSquareOrder(deps.square, deps.locationAccessToken, {
    squareLocationId: deps.squareLocationId,
    referenceId: order.id,
    lines: buildSquareLines(lines),
  });
  const squareOrderId = squareOrder.order?.id;
  if (!squareOrderId) throw new Error('Square returned no order id.');

  // The card charge is what stored value did not cover.
  const cardChargeCents = order.total_cents - order.stored_value_applied_cents;

  // Rule 3: the month's gross so far decides the tier for this payment.
  const fee = await appFeeForCharge(deps.db, {
    locationId: order.location_id,
    chargeCents: cardChargeCents,
    feeConfig: deps.feeConfig,
    locationTimezone: deps.locationTimezone,
  });

  const payment = await createSquarePayment(deps.square, deps.locationAccessToken, {
    sourceId: input.sourceId,
    squareOrderId,
    referenceId: order.id,
    amountCents: cardChargeCents - order.tip_cents,
    tipCents: order.tip_cents,
    appFeeCents: fee.feeCents,
  });
  const paymentId = payment.payment?.id;
  if (!paymentId) throw new Error('Square returned no payment id.');

  // Checked, because this is the field a refund later depends on: an
  // unchecked failure here left a charged card on an order the app could
  // never return money for, while the rest of the function reported success.
  const linked = await deps.db
    .from('orders')
    .update({ square_order_id: squareOrderId, square_payment_id: paymentId })
    .eq('id', order.id);
  if (linked.error) {
    throw new Error(
      `Square payment ${paymentId} was taken but could not be recorded on order ${order.id}: ${linked.error.message}`,
    );
  }

  // Record the fee before advancing state. If this call fails, the order is
  // still created and the replay path above repairs it. Once paid is visible,
  // the fee row is therefore already durable.
  await insertPlatformFeeOnce(deps.db, {
    brand_id: order.brand_id,
    location_id: order.location_id,
    order_id: order.id,
    gross_cents: cardChargeCents,
    fee_cents: fee.feeCents,
    fee_bps_applied: fee.feeBpsApplied,
    square_payment_id: paymentId,
  });

  // State moves through order_events only (rule 2). Its database trigger
  // grants loyalty in the same transaction, including staff-recorded cash.
  const { error: eventError } = await deps.db.from('order_events').insert({
    brand_id: order.brand_id,
    order_id: order.id,
    type: 'paid',
    snapshot: { ...order.totals, square_payment_id: paymentId, card_charge_cents: cardChargeCents },
    source: 'system',
  });
  if (eventError) throw eventError;

  return { orderId: order.id, squarePaymentId: paymentId };
}
