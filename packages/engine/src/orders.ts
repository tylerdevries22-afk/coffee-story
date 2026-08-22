/**
 * Order placement, end to end: validate -> orders row (created) -> Square
 * order -> Square payment carrying app_fee_money -> paid event ->
 * platform_fees row -> loyalty earn. One place, so the money path reads top
 * to bottom.
 *
 * Everything external is injected (service-role Supabase client, Square
 * config + the location's decrypted token), which keeps this testable and
 * keeps credentials at the edges.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { computeAppFeeCents, feeMonthKey, type FeeConfig } from './fees';
import { pointsEarnedFor } from './loyalty';
import {
  createSquareOrder,
  createSquarePayment,
  type SquareConfig,
  type SquareOrderLine,
} from './square/client';

export type PlaceOrderInput = {
  brandId: string;
  locationId: string;
  customerId: string | null;
  fulfillmentType: 'pickup' | 'curbside' | 'catering' | 'delivery';
  scheduledFor: string | null;
  note: string;
  lines: readonly {
    itemId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    options: readonly string[];
  }[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  loyaltyRedeemedPoints: number;
  storedValueAppliedCents: number;
  /** Card token from the app's payment SDK. */
  sourceId: string;
};

/** The cart lines in Square's shape. Pure; covered by orders.test.ts. */
export function buildSquareLines(lines: PlaceOrderInput['lines']): SquareOrderLine[] {
  return lines.map((line) => ({
    name: line.options.length > 0 ? `${line.name} (${line.options.join(', ')})` : line.name,
    quantity: String(line.quantity),
    base_price_money: { amount: line.unitPriceCents, currency: 'USD' },
  }));
}

export type PlaceOrderDeps = {
  db: SupabaseClient;
  square: SquareConfig;
  locationAccessToken: string;
  squareLocationId: string;
  feeConfig: FeeConfig;
  locationTimezone: string;
};

export async function placeOrder(deps: PlaceOrderDeps, input: PlaceOrderInput): Promise<{ orderId: string }> {
  const snapshot = {
    lines: input.lines.map((line) => ({
      item_id: line.itemId,
      name: line.name,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      options: line.options,
    })),
    subtotal_cents: input.subtotalCents,
    tax_cents: input.taxCents,
    tip_cents: input.tipCents,
    total_cents: input.totalCents,
  };

  const { data: order, error: orderError } = await deps.db
    .from('orders')
    .insert({
      brand_id: input.brandId,
      location_id: input.locationId,
      customer_id: input.customerId,
      fulfillment_type: input.fulfillmentType,
      scheduled_for: input.scheduledFor,
      note: input.note,
      totals: snapshot,
      subtotal_cents: input.subtotalCents,
      tax_cents: input.taxCents,
      tip_cents: input.tipCents,
      total_cents: input.totalCents,
      loyalty_redeemed_points: input.loyaltyRedeemedPoints,
      stored_value_applied_cents: input.storedValueAppliedCents,
    })
    .select('id')
    .single();
  if (orderError) throw orderError;

  const squareOrder = await createSquareOrder(deps.square, deps.locationAccessToken, {
    squareLocationId: deps.squareLocationId,
    referenceId: order.id,
    lines: buildSquareLines(input.lines),
  });
  const squareOrderId = squareOrder.order?.id;
  if (!squareOrderId) throw new Error('Square returned no order id.');

  // The card charge is what stored value did not cover.
  const cardChargeCents = input.totalCents - input.storedValueAppliedCents;

  // Rule 3: the month's gross so far decides the tier for this payment.
  const monthKey = feeMonthKey(new Date(), deps.locationTimezone);
  const { data: monthRows, error: monthError } = await deps.db
    .from('platform_fees')
    .select('gross_cents, created_at')
    .eq('location_id', input.locationId)
    .gte('created_at', `${monthKey}-01`);
  if (monthError) throw monthError;
  const monthGrossBefore = (monthRows ?? []).reduce(
    (sum: number, row: { gross_cents: number }) => sum + row.gross_cents, 0);
  const fee = computeAppFeeCents(deps.feeConfig, monthGrossBefore, cardChargeCents);

  const payment = await createSquarePayment(deps.square, deps.locationAccessToken, {
    sourceId: input.sourceId,
    squareOrderId,
    referenceId: order.id,
    amountCents: cardChargeCents - input.tipCents,
    tipCents: input.tipCents,
    appFeeCents: fee.feeCents,
  });
  const paymentId = payment.payment?.id;
  if (!paymentId) throw new Error('Square returned no payment id.');

  await deps.db.from('orders').update({ square_order_id: squareOrderId, square_payment_id: paymentId }).eq('id', order.id);

  // The paid event: state moves through order_events only (rule 2). The
  // webhook will assert paid again with its own event id; the trigger treats
  // the re-assertion as idempotent.
  const { error: eventError } = await deps.db.from('order_events').insert({
    brand_id: input.brandId,
    order_id: order.id,
    type: 'paid',
    snapshot: { ...snapshot, square_payment_id: paymentId, card_charge_cents: cardChargeCents },
    source: 'system',
  });
  if (eventError) throw eventError;

  const { error: feeError } = await deps.db.from('platform_fees').insert({
    brand_id: input.brandId,
    location_id: input.locationId,
    order_id: order.id,
    gross_cents: cardChargeCents,
    fee_cents: fee.feeCents,
    fee_bps_applied: fee.feeBpsApplied,
    square_payment_id: paymentId,
  });
  if (feeError) throw feeError;

  // Loyalty earn on the qualifying spend (subtotal, not tax or tip).
  if (input.customerId) {
    const earned = pointsEarnedFor(input.subtotalCents);
    if (earned > 0) {
      const { data: account } = await deps.db
        .from('loyalty_accounts')
        .select('id, points_balance, lifetime_points')
        .eq('customer_id', input.customerId)
        .maybeSingle();
      if (account) {
        await deps.db.from('loyalty_events').insert({
          brand_id: input.brandId,
          account_id: account.id,
          order_id: order.id,
          type: 'earn',
          points: earned,
        });
        await deps.db
          .from('loyalty_accounts')
          .update({
            points_balance: account.points_balance + earned,
            lifetime_points: account.lifetime_points + earned,
          })
          .eq('id', account.id);
      }
    }
  }

  return { orderId: order.id };
}
