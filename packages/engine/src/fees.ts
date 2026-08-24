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

/** Rule 3's numbers as the brand row carries them. */
export type BrandFeeTerms = {
  fee_bps: number;
  fee_bps_tier2: number;
  tier_threshold_cents: number;
};

/**
 * A location's negotiated overrides. Every field nullable: NULL inherits.
 */
export type LocationFeeTerms = {
  fee_bps?: number | null;
  fee_bps_tier2?: number | null;
  tier_threshold_cents?: number | null;
};

/**
 * The terms one payment is actually charged at.
 *
 * Rule 3 puts the take on the brand, which is right for a shop and for a chain
 * a brand owns outright, and wrong the moment the brand carries franchisees:
 * terms are negotiated per franchisee, and expressing that with brand columns
 * alone would mean a second brand -- splitting the menu, the loyalty ladder
 * and the guest's account along a line that exists purely for billing.
 *
 * So the location overrides field by field rather than wholesale (0039). A
 * franchisee who negotiated a rate but not a threshold still moves with the
 * brand when the threshold changes, which is what "we renegotiated the rate"
 * actually means and what a wholesale override would quietly break.
 *
 * Lives here rather than beside the Square runtime that used to own it: which
 * numbers apply to a payment is rule 3, not HTTP plumbing, and `apps/hq` was
 * the only caller purely because it was the only one that had needed it yet.
 */
export function resolveFeeConfig(
  brand: BrandFeeTerms,
  location?: LocationFeeTerms | null,
): FeeConfig {
  const override = (value: number | null | undefined, fallback: number): number =>
    (typeof value === 'number' && Number.isFinite(value) ? value : Number(fallback));
  return {
    feeBps: override(location?.fee_bps, brand.fee_bps),
    feeBpsTier2: override(location?.fee_bps_tier2, brand.fee_bps_tier2),
    tierThresholdCents: override(location?.tier_threshold_cents, brand.tier_threshold_cents),
  };
}

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

/** How far the zone is from UTC at a given instant, in minutes. */
function offsetMinutesAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  // Intl renders hour 24 for midnight in some locales' 24-hour output.
  const hour = at('hour') % 24;
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), hour, at('minute'), at('second'));
  return (asIfUtc - instant.getTime()) / 60_000;
}

/** The UTC instant of a wall-clock time in the given zone. */
function utcInstantOf(year: number, month: number, timezone: string): Date {
  const naive = Date.UTC(year, month - 1, 1, 0, 0, 0);
  // Two passes: the first offset is read at the wrong instant when the guess
  // lands on the far side of a DST change, and correcting once settles it.
  let guess = naive - offsetMinutesAt(new Date(naive), timezone) * 60_000;
  guess = naive - offsetMinutesAt(new Date(guess), timezone) * 60_000;
  return new Date(guess);
}

/**
 * The half-open UTC range covering a location's calendar month.
 *
 * The tier that decides a payment's fee is the location's gross for its own
 * month, and the query used to filter on the bare date string "2026-08-01",
 * which Postgres resolves at UTC midnight. For a shop in Denver that swept
 * six hours of July 31 -- its busiest close -- into August's gross, and for
 * a shop ahead of UTC it dropped real August-1 payments. Either way the
 * threshold tripped on the wrong day and the wrong rate was billed.
 */
export function feeMonthRange(paidAt: Date, timezone: string): { startIso: string; endIso: string } {
  const [year, month] = feeMonthKey(paidAt, timezone).split('-').map(Number) as [number, number];
  const start = utcInstantOf(year, month, timezone);
  const end = month === 12
    ? utcInstantOf(year + 1, 1, timezone)
    : utcInstantOf(year, month + 1, timezone);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
