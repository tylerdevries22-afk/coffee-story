/** Durable fee quotes reserve monthly volume before an external charge. */
import type { SupabaseClient } from '@supabase/supabase-js';

import { feeMonthRange, type FeeConfig } from '../fees';
import { squareApplicationFeeCapCents } from '../square/payment-receipt';

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
    connectionId: string;
    connectionGeneration: string;
    chargeCents: number;
    feeConfig: FeeConfig;
    locationTimezone: string;
    requireExisting?: boolean;
    /**
     * The instant the month boundary is computed against. Defaults to
     * `new Date()`; a caller (namely a test asserting the exact range sent to
     * the database) can pin it so the assertion is not a second, independent
     * `new Date()` racing this one across a local-month boundary.
     */
    now?: Date;
  },
): Promise<{
  feeCents: number;
  feeBpsApplied: number;
} & ({ claimGeneration: string; claimCreated: true }
  | { claimGeneration: null; claimCreated: false })> {
  const rates = [input.feeConfig.feeBps, input.feeConfig.feeBpsTier2];
  if (!Number.isSafeInteger(input.chargeCents) || input.chargeCents <= 0
    || !rates.every((rate) => Number.isSafeInteger(rate) && rate >= 0 && rate <= 9_000)
    || !Number.isSafeInteger(input.feeConfig.tierThresholdCents)
    || input.feeConfig.tierThresholdCents < 0) {
    throw new RangeError('Invalid platform fee quote inputs.');
  }
  const { startIso, endIso } = feeMonthRange(input.now ?? new Date(), input.locationTimezone);
  const { data, error } = await db.rpc('claim_platform_fee_quote', {
    p_order_id: input.orderId,
    p_location_id: input.locationId,
    p_connection_id: input.connectionId,
    p_connection_generation: input.connectionGeneration,
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
    quote_claim_generation: string | null;
    quote_claim_created: boolean;
  }>();
  if (error) throw error;
  const squareFeeCap = squareApplicationFeeCapCents(input.chargeCents);
  if (!Number.isSafeInteger(data.quoted_fee_cents) || data.quoted_fee_cents < 0
    || data.quoted_fee_cents > squareFeeCap
    || !Number.isSafeInteger(data.quoted_fee_bps_applied)
    || data.quoted_fee_bps_applied < 0 || data.quoted_fee_bps_applied > 9_000
    || typeof data.quote_claim_created !== 'boolean'
    || (data.quote_claim_created
      ? typeof data.quote_claim_generation !== 'string'
      : data.quote_claim_generation !== null)) {
    throw new Error('Platform fee quote returned invalid data.');
  }
  const common = {
    feeCents: Number(data.quoted_fee_cents),
    feeBpsApplied: data.quoted_fee_bps_applied,
  };
  return data.quote_claim_created
    ? { ...common, claimGeneration: data.quote_claim_generation as string, claimCreated: true }
    : { ...common, claimGeneration: null, claimCreated: false };
}
