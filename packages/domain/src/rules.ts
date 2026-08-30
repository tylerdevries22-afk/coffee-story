// The loyalty ladder every tenant starts from, and the arithmetic behind it.
//
// Tier names and copy are owner-editable, so the name is free text rather than
// a union and nothing here switches on a specific one without a fallback. The
// shipped rungs name no tenant: this constant is what a brand that has not
// written its own ladder renders, and it used to tell a second franchisee's
// guests they were making the first franchisee's shop part of their day.
export type RewardTierName = string;

export type RewardTier = {
  name: RewardTierName;
  minimumAnnualPoints: number;
  pointsPerDollar: number;
  description: string;
  perks: readonly string[];
};

/**
 * The ladder as shipped. This constant is the fallback for surfaces that must
 * render with no backend -- the marketing site and the Expo Go demo -- and the
 * default for callers that do not pass a ladder.
 */
const BASE_TIER: RewardTier = { name: 'First Sip', minimumAnnualPoints: 0, pointsPerDollar: 10, description: 'Where every regular starts.', perks: ['Member-only drink offers'] };

export const REWARD_TIERS: readonly RewardTier[] = [
  BASE_TIER,
  { name: 'Daily Ritual', minimumAnnualPoints: 500, pointsPerDollar: 11, description: 'For guests settling into a daily rhythm.', perks: ['Birthday drink on us'] },
  { name: 'House Regular', minimumAnnualPoints: 1500, pointsPerDollar: 12, description: 'For guests who make us part of their day.', perks: ['Free size upgrade'] },
  { name: 'Coffee Legend', minimumAnnualPoints: 2500, pointsPerDollar: 13, description: 'Our most dedicated regulars.', perks: ['5% off + priority pickup'] },
] as const;

export type PurchaseBreakdown = {
  itemsCents: number;
  giftCardsCents: number;
  deliveryCents: number;
  tipsCents: number;
  taxesCents: number;
  serviceFeesCents: number;
  paidWithGiftCardCents: number;
  paidWithRewardsCents: number;
};

/**
 * Ascending by threshold. An edited ladder arrives in whatever order it was
 * saved, and every function below reads the ladder positionally.
 */
export function sortedTiers(tiers: readonly RewardTier[]): readonly RewardTier[] {
  return [...tiers].sort((left, right) => left.minimumAnnualPoints - right.minimumAnnualPoints);
}

export function tierForAnnualPoints(annualPoints: number, tiers: readonly RewardTier[] = REWARD_TIERS): RewardTier {
  const ladder = sortedTiers(tiers.length > 0 ? tiers : REWARD_TIERS);
  const safeAnnualPoints = Number.isFinite(annualPoints) ? Math.max(0, annualPoints) : 0;
  const eligible = ladder.filter((tier) => safeAnnualPoints >= tier.minimumAnnualPoints);
  // Both fallbacks are unreachable -- `ladder` is non-empty by construction
  // above -- but naming the base rung is cheaper than an assertion that
  // tells a future reader nothing about why it is safe.
  return eligible.at(-1) ?? ladder[0] ?? BASE_TIER;
}

export function qualifyingSpendCents(purchase: PurchaseBreakdown): number {
  const eligible = purchase.itemsCents + purchase.giftCardsCents + purchase.deliveryCents + purchase.tipsCents;
  const excludedTender = purchase.paidWithGiftCardCents + purchase.paidWithRewardsCents;
  return Math.max(0, eligible - excludedTender);
}

export function pointsForPurchase(purchase: PurchaseBreakdown, annualPoints: number, tiers: readonly RewardTier[] = REWARD_TIERS): number {
  const spendInDollars = qualifyingSpendCents(purchase) / 100;
  return Math.floor(spendInDollars * tierForAnnualPoints(annualPoints, tiers).pointsPerDollar);
}

export function pointsExpireAt(earnedAt: Date): Date {
  const expiry = new Date(earnedAt);
  if (Number.isNaN(expiry.getTime())) throw new RangeError('A valid earned-at date is required.');
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry;
}

export function nextTier(currentAnnualPoints: number, tiers: readonly RewardTier[] = REWARD_TIERS): RewardTier | null {
  return sortedTiers(tiers).find((tier) => tier.minimumAnnualPoints > currentAnnualPoints) ?? null;
}

export function rewardMilestoneStates(annualPoints: number, tiers: readonly RewardTier[] = REWARD_TIERS): boolean[] {
  const safeAnnualPoints = Number.isFinite(annualPoints) ? Math.max(0, annualPoints) : 0;
  return sortedTiers(tiers).map((tier) => safeAnnualPoints >= tier.minimumAnnualPoints);
}
