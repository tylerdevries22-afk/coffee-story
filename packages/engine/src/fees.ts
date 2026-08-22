/**
 * Rule 3's fee service: every payment carries app_fee_money computed from
 * the brand's fee_bps, with per-location volume tiering -- once a location's
 * gross for the calendar month passes tier_threshold_cents, the portion
 * above it is charged fee_bps_tier2.
 *
 * A payment that straddles the threshold is split: the cents below pay the
 * full rate, the cents above pay the discounted one, and the fee rounds once
 * on the total so two half-cent parts cannot both round up.
 */

export type FeeConfig = {
  feeBps: number;
  feeBpsTier2: number;
  tierThresholdCents: number;
};

export function computeAppFeeCents(
  config: FeeConfig,
  monthGrossBeforeCents: number,
  paymentCents: number,
): { feeCents: number; feeBpsApplied: number } {
  if (!Number.isInteger(paymentCents) || paymentCents <= 0) {
    return { feeCents: 0, feeBpsApplied: config.feeBps };
  }
  const before = Math.max(0, Math.trunc(monthGrossBeforeCents));
  const belowRoom = Math.max(0, config.tierThresholdCents - before);
  const below = Math.min(paymentCents, belowRoom);
  const above = paymentCents - below;
  const feeCents = Math.round((below * config.feeBps + above * config.feeBpsTier2) / 10_000);
  // The bps recorded on the platform_fees row: the effective rate in whole
  // bps, so the report can show what was actually charged.
  const feeBpsApplied = Math.round((feeCents * 10_000) / paymentCents);
  return { feeCents, feeBpsApplied };
}

/** Which calendar month a payment belongs to, in the location's timezone. */
export function feeMonthKey(paidAt: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit' });
  return formatter.format(paidAt); // "2026-08"
}
