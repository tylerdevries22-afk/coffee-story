/**
 * The platform's cut of settled card payments (rule 3): the month's gross
 * before the charge decides the tier, and each payment writes its
 * platform_fees row exactly once.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { computeAppFeeCents, feeMonthRange, type FeeConfig } from '../fees';

/**
 * The platform's cut for one settled card payment (rule 3), written once.
 *
 * platform_fees is both the revenue record and the input to the volume tier —
 * appFeeForCharge sums the month's rows to decide which rate applies — so a
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
  },
): Promise<void> {
  if (input.grossCents <= 0) return;
  const brand = await db
    .from('brands')
    .select('fee_bps, fee_bps_tier2, tier_threshold_cents')
    .eq('id', input.brandId)
    .single<{ fee_bps: number; fee_bps_tier2: number; tier_threshold_cents: number }>();
  if (brand.error) throw brand.error;
  const location = await db
    .from('locations')
    .select('timezone')
    .eq('id', input.locationId)
    .single<{ timezone: string | null }>();
  if (location.error) throw location.error;

  const fee = await appFeeForCharge(db, {
    locationId: input.locationId,
    chargeCents: input.grossCents,
    feeConfig: {
      feeBps: Number(brand.data.fee_bps),
      feeBpsTier2: Number(brand.data.fee_bps_tier2),
      tierThresholdCents: Number(brand.data.tier_threshold_cents),
    },
    locationTimezone: location.data.timezone ?? 'UTC',
  });

  await insertPlatformFeeOnce(db, {
    brand_id: input.brandId,
    location_id: input.locationId,
    order_id: input.orderId,
    gross_cents: input.grossCents,
    fee_cents: fee.feeCents,
    fee_bps_applied: fee.feeBpsApplied,
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
 * Rule 3's tiering needs the month's gross before this charge, per location.
 * Both money paths ask the same question, so they ask it in one place.
 */
export async function appFeeForCharge(
  db: SupabaseClient,
  input: { locationId: string; chargeCents: number; feeConfig: FeeConfig; locationTimezone: string },
): Promise<{ feeCents: number; feeBpsApplied: number }> {
  // The location's own month, as UTC instants: a bare date string resolves
  // at UTC midnight, which is not when the month starts anywhere but UTC.
  const { startIso, endIso } = feeMonthRange(new Date(), input.locationTimezone);
  const { data, error } = await db
    .from('platform_fees')
    .select('gross_cents, created_at')
    .eq('location_id', input.locationId)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (error) throw error;
  const monthGrossBefore = (data ?? []).reduce(
    (sum: number, row: { gross_cents: number }) => sum + row.gross_cents, 0);
  return computeAppFeeCents(input.feeConfig, monthGrossBefore, input.chargeCents);
}
