/**
 * Loyalty movements: earn on paid, reverse on refund, adjust from HQ. The
 * balance on loyalty_accounts is a projection maintained in the same
 * transaction as the event insert; this module owns the arithmetic.
 */

/** Points per dollar of qualifying spend (subtotal after discounts, no tax/tip). */
export const DEFAULT_EARN_RATE_PER_DOLLAR = 10;

export function pointsEarnedFor(qualifyingSpendCents: number, ratePerDollar = DEFAULT_EARN_RATE_PER_DOLLAR): number {
  if (!Number.isInteger(qualifyingSpendCents) || qualifyingSpendCents <= 0) return 0;
  return Math.floor((qualifyingSpendCents / 100) * ratePerDollar);
}

/**
 * A refund reverses the earn proportionally to the refunded share, and never
 * reverses more than was earned. Partial refund of a partly-redeemed order
 * stays simple and favours the guest: redeemed points are not clawed back.
 */
export function pointsToReverse(
  earnedPoints: number,
  orderTotalCents: number,
  refundedCents: number,
): number {
  if (earnedPoints <= 0 || orderTotalCents <= 0 || refundedCents <= 0) return 0;
  const share = Math.min(1, refundedCents / orderTotalCents);
  return Math.min(earnedPoints, Math.round(earnedPoints * share));
}

export function applyLedger(balance: number, delta: number): number {
  // The account can never go negative from a reversal racing a redemption;
  // clamp and let the event log carry the truth.
  return Math.max(0, balance + delta);
}
