/**
 * The platform's cut of settled card payments (rule 3): the month's gross
 * before the charge decides the tier, and each payment writes its
 * platform_fees row exactly once.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  computeAppFeeCents, feeMonthRange, type FeeConfig,
} from '../fees';

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
  let monthGrossBefore = 0;
  let afterId: string | undefined;
  // A REST response is capped independently of the requested limit. Advance
  // by the last immutable key and stop only on an empty page, so a lower
  // deployment cap cannot silently move a busy location back to tier one.
  while (true) {
    let query = db.from('platform_fees')
      .select('id, gross_cents')
      .eq('location_id', input.locationId)
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('id', { ascending: true })
      .limit(1_000);
    if (afterId) query = query.gt('id', afterId);
    const { data, error } = await query.returns<{ id: string; gross_cents: number }[]>();
    if (error) throw error;
    const last = data?.at(-1);
    if (!last) break;
    if (last.id === afterId) throw new Error('Monthly fee pagination did not advance.');
    monthGrossBefore += data.reduce((sum, row) => sum + row.gross_cents, 0);
    afterId = last.id;
  }
  return computeAppFeeCents(input.feeConfig, monthGrossBefore, input.chargeCents);
}
