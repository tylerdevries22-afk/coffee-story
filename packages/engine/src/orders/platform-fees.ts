/**
 * The platform's cut of settled card payments (rule 3): the month's gross
 * before the charge decides the tier, and each payment writes its
 * platform_fees row exactly once.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { feeMonthRange, type FeeConfig } from '../fees';

/**
 * The platform's cut for one settled card payment (rule 3), written once.
 *
 * platform_fees is both the revenue record and an input to the volume tier, so a
 * payment that never writes one is billed at tier 1 forever and quietly
 * under-reports the platform's own revenue. `square_payment_id` is UNIQUE, so
 * a replayed settlement lands on the conflict rather than a second row.
 */
export async function recordPlatformFee(
  db: SupabaseClient,
  input: {
    brandId: string;
    locationId: string;
    orderId: string;
    squarePaymentId: string;
    grossCents: number;
    /** Actual application fee from the authenticated provider settlement. */
    settledFeeCents: number;
  },
): Promise<void> {
  const { grossCents, settledFeeCents } = input;
  if (!Number.isSafeInteger(grossCents) || grossCents < 0
    || !Number.isSafeInteger(settledFeeCents) || settledFeeCents < 0
    || settledFeeCents > grossCents) {
    throw new RangeError('Invalid settled payment amounts.');
  }
  if (grossCents === 0) return;
  // Validate the location's tenant even though settlement uses provider money.
  const location = await db.from('locations').select('id')
    .eq('id', input.locationId).eq('brand_id', input.brandId).single();
  if (location.error) throw location.error;
  // A hosted link can settle after another payment, a month boundary, or a
  // contract edit. Repricing here would invent revenue Square never charged.
  const feeBpsApplied = Math.round((settledFeeCents / grossCents) * 10_000);

  await insertPlatformFeeOnce(db, {
    brand_id: input.brandId,
    location_id: input.locationId,
    order_id: input.orderId,
    gross_cents: input.grossCents,
    fee_cents: settledFeeCents,
    fee_bps_applied: feeBpsApplied,
    square_payment_id: input.squarePaymentId,
  });
}

type PlatformFeeInsert = {
  brand_id: string;
  location_id: string;
  order_id: string;
  gross_cents: number;
  fee_cents: number;
  fee_bps_applied: number;
  square_payment_id: string;
};

export async function insertPlatformFeeOnce(db: SupabaseClient, row: PlatformFeeInsert): Promise<void> {
  const { error } = await db.from('platform_fees').insert(row);
  // A lost HTTP response can replay after the first insert committed. The
  // payment id is unique, so that conflict is the success we already had.
  if (error && error.code !== '23505') throw error;
}

/**
 * Atomically reserve this order's place in the location's monthly volume.
 * Square is an external call, so it cannot share the database transaction;
 * the durable quote keeps concurrent checkouts from consuming the same tier.
 */
export async function appFeeForCharge(
  db: SupabaseClient,
  input: {
    orderId: string;
    locationId: string;
    chargeCents: number;
    feeConfig: FeeConfig;
    locationTimezone: string;
    requireExisting?: boolean;
  },
): Promise<{
  feeCents: number;
  feeBpsApplied: number;
  claimGeneration: string;
  claimCreated: boolean;
}> {
  const { startIso, endIso } = feeMonthRange(new Date(), input.locationTimezone);
  const { data, error } = await db.rpc('claim_platform_fee_quote', {
    p_order_id: input.orderId,
    p_location_id: input.locationId,
    p_charge_cents: input.chargeCents,
    p_fee_bps: input.feeConfig.feeBps,
    p_fee_bps_tier2: input.feeConfig.feeBpsTier2,
    p_tier_threshold_cents: input.feeConfig.tierThresholdCents,
    p_month_start: startIso,
    p_month_end: endIso,
    p_require_existing: input.requireExisting ?? false,
  }).single<{
    quoted_fee_cents: number;
    quoted_fee_bps_applied: number;
    quote_claim_generation: string;
    quote_claim_created: boolean;
  }>();
  if (error) throw error;
  if (typeof data.quote_claim_generation !== 'string') {
    throw new Error('Platform fee quote returned no claim generation.');
  }
  return {
    feeCents: Number(data.quoted_fee_cents),
    feeBpsApplied: data.quoted_fee_bps_applied,
    claimGeneration: data.quote_claim_generation,
    claimCreated: data.quote_claim_created === true,
  };
}

/** Release a quote after the provider definitively rejects the payment. */
export async function releasePlatformFeeQuote(
  db: SupabaseClient,
  orderId: string,
  claimGeneration: string,
): Promise<void> {
  const { error } = await db.rpc('release_platform_fee_quote', {
    p_order_id: orderId,
    p_claim_generation: claimGeneration,
  });
  if (error) throw error;
}

export async function bindSquareCheckoutLink(
  db: SupabaseClient,
  input: {
    orderId: string;
    claimGeneration: string;
    checkoutUrl: string;
    paymentLinkId: string;
    squareOrderId: string | null;
  },
): Promise<void> {
  const { data, error } = await db.rpc('bind_square_checkout_link', {
    p_order_id: input.orderId,
    p_claim_generation: input.claimGeneration,
    p_checkout_url: input.checkoutUrl,
    p_payment_link_id: input.paymentLinkId,
    p_square_order_id: input.squareOrderId,
  });
  if (error) throw error;
  if (data !== true) throw new Error('The Square checkout quote changed before the link was saved.');
}

export async function bindSquarePayment(
  db: SupabaseClient,
  input: {
    orderId: string;
    claimGeneration: string;
    squareOrderId: string;
    squarePaymentId: string;
  },
): Promise<void> {
  const { data, error } = await db.rpc('bind_square_payment', {
    p_order_id: input.orderId,
    p_claim_generation: input.claimGeneration,
    p_square_order_id: input.squareOrderId,
    p_square_payment_id: input.squarePaymentId,
  });
  if (error) throw error;
  if (data !== true) throw new Error('The Square fee quote changed before the payment was saved.');
}

export async function bindSquarePaymentAttempt(
  db: SupabaseClient,
  input: { orderId: string; claimGeneration: string; squareOrderId: string },
): Promise<void> {
  const { data, error } = await db.rpc('bind_square_payment_attempt', {
    p_order_id: input.orderId,
    p_claim_generation: input.claimGeneration,
    p_square_order_id: input.squareOrderId,
  });
  if (error) throw error;
  if (data !== true) throw new Error('The Square fee quote changed before the payment attempt was saved.');
}
