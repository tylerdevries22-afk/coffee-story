import type { SupabaseClient } from '@supabase/supabase-js';

import type { FeeConfig } from '../fees';
import {
  createSquareOrder, createSquarePayment, getSquarePayment, type SquareConfig,
} from '../square/client';

import { settledPaymentFee } from '../square/payment-receipt';

import type { SnapshotLine } from './internal';
import {
  appFeeForCharge, bindSquarePayment, bindSquarePaymentAttempt,
  insertPlatformFeeOnce, releasePlatformFeeQuote,
} from './platform-fees';
import { isDefinitiveSquareRejection } from './provider-error';
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
    .select('id, brand_id, location_id, customer_id, status, tender_type, totals, subtotal_cents, tip_cents, total_cents, stored_value_applied_cents, square_order_id, square_payment_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      location_id: string;
      customer_id: string | null;
      status: string;
      tender_type: string;
      totals: { lines?: SnapshotLine[] } & Record<string, unknown>;
      subtotal_cents: number;
      tip_cents: number;
      total_cents: number;
      stored_value_applied_cents: number;
      square_order_id: string | null;
      square_payment_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');
  if (order.tender_type !== 'square_card') {
    throw new OrderError('invalid_request', `Order is a ${order.tender_type} order; only square_card orders can be captured.`);
  }
  if (order.square_payment_id) {
    const cardChargeCents = order.total_cents - order.stored_value_applied_cents;
    const receipt = await getSquarePayment(deps.square, deps.locationAccessToken, order.square_payment_id);
    const fee = settledPaymentFee(receipt.payment, order.square_payment_id, cardChargeCents);
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
  const cardChargeCents = order.total_cents - order.stored_value_applied_cents;
  const fee = await appFeeForCharge(deps.db, {
    orderId: order.id,
    locationId: order.location_id,
    chargeCents: cardChargeCents,
    feeConfig: deps.feeConfig,
    locationTimezone: deps.locationTimezone,
  });
  let squareOrderId = order.square_order_id;
  if (!squareOrderId) {
    if (!fee.claimCreated) {
      throw new OrderError('invalid_request', 'A card payment attempt is already in progress. Retry shortly.');
    }
    try {
      const squareOrder = await createSquareOrder(deps.square, deps.locationAccessToken, {
        squareLocationId: deps.squareLocationId,
        referenceId: order.id,
        lines: buildSquareLines(lines),
      });
      squareOrderId = squareOrder.order?.id ?? null;
    } catch (error) {
      if (isDefinitiveSquareRejection(error)) {
        await releasePlatformFeeQuote(deps.db, order.id, fee.claimGeneration);
      }
      throw error;
    }
    if (!squareOrderId) throw new Error('Square returned no order id.');
    try {
      await bindSquarePaymentAttempt(deps.db, {
        orderId: order.id, claimGeneration: fee.claimGeneration, squareOrderId,
      });
    } catch (error) {
      throw new Error(`Square order ${squareOrderId} could not be secured before payment: ${String(error)}`);
    }
  }

  let payment;
  try {
    payment = await createSquarePayment(deps.square, deps.locationAccessToken, {
      sourceId: input.sourceId,
      squareOrderId,
      referenceId: order.id,
      amountCents: cardChargeCents - order.tip_cents,
      tipCents: order.tip_cents,
      appFeeCents: fee.feeCents,
    });
  } catch (error) {
    if (fee.claimCreated && isDefinitiveSquareRejection(error)) {
      await releasePlatformFeeQuote(deps.db, order.id, fee.claimGeneration);
    }
    throw error;
  }
  const paymentId = payment.payment?.id;
  if (!paymentId) throw new Error('Square returned no payment id.');
  const settledFee = settledPaymentFee(payment.payment, paymentId, cardChargeCents);

  try {
    await bindSquarePayment(deps.db, {
      orderId: order.id,
      claimGeneration: fee.claimGeneration,
      squareOrderId,
      squarePaymentId: paymentId,
    });
  } catch (error) {
    throw new Error(
      `Square payment ${paymentId} was taken but could not be recorded on order ${order.id}: ${String(error)}`,
    );
  }

  await insertPlatformFeeOnce(deps.db, {
    brand_id: order.brand_id,
    location_id: order.location_id,
    order_id: order.id,
    gross_cents: cardChargeCents,
    fee_cents: settledFee.feeCents,
    fee_bps_applied: settledFee.feeBpsApplied,
    square_payment_id: paymentId,
  });

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
