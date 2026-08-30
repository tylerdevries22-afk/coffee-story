// The loyalty ladder, and the arithmetic behind it.
//
// The ladder is tenant data: a brand writes `loyalty.tiers` in its brand.json
// and `resolveRewardTiers` reads it. Tier names are free text rather than a
// union, and nothing here switches on a specific one without a fallback.
//
// The rungs shipped below are the fallback a brand that has not written its own
// ladder renders, so they are deliberately generic -- they named a coffee shop
// once, which told a bakery franchisee's guests they had become a Coffee
// Legend.
export type RewardTierName = string;

export type RewardTier = {
  name: RewardTierName;
  minimumAnnualPoints: number;
  pointsPerDollar: number;
  description: string;
  perks: readonly string[];
};

/**
 * The ladder as shipped. The fallback for surfaces that must render with no
 * tenant config -- the marketing site and the Expo Go demo -- and the default
 * for callers that do not pass a ladder.
 */
const BASE_TIER: RewardTier = { name: 'Member', minimumAnnualPoints: 0, pointsPerDollar: 10, description: 'Where every regular starts.', perks: ['Member-only offers'] };

export const REWARD_TIERS: readonly RewardTier[] = [
  BASE_TIER,
  { name: 'Regular', minimumAnnualPoints: 500, pointsPerDollar: 11, description: 'For guests settling into a rhythm.', perks: ['A birthday reward'] },
  { name: 'Insider', minimumAnnualPoints: 1500, pointsPerDollar: 12, description: 'For guests who make us part of their day.', perks: ['Free upgrades'] },
  { name: 'Legend', minimumAnnualPoints: 2500, pointsPerDollar: 13, description: 'Our most dedicated regulars.', perks: ['5% off + priority pickup'] },
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

/**
 * A ladder from a brand config's `loyalty.tiers`, or null when the tenant has
 * not written one.
 *
 * All-or-nothing, like `weekFromHours`. A half-parsed ladder would put a guest
 * on a rung the owner never published, and every rung carries an earn rate, so
 * a dropped row is money. Null means "the shipped ladder", which is generic on
 * purpose.
 */
export function rewardTiersFrom(value: unknown): readonly RewardTier[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const tiers: RewardTier[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const minimumAnnualPoints = Number(row.minimumAnnualPoints);
    const pointsPerDollar = Number(row.pointsPerDollar);
    if (!name) return null;
    if (!Number.isInteger(minimumAnnualPoints) || minimumAnnualPoints < 0) return null;
    if (!Number.isFinite(pointsPerDollar) || pointsPerDollar <= 0) return null;
    tiers.push({
      name,
      minimumAnnualPoints,
      pointsPerDollar,
      description: typeof row.description === 'string' ? row.description : '',
      perks: Array.isArray(row.perks) ? row.perks.filter((perk): perk is string => typeof perk === 'string') : [],
    });
  }
  // A ladder whose lowest rung is not zero leaves a new guest on no rung at
  // all, which every caller here would then have to invent an answer for.
  if (!tiers.some((tier) => tier.minimumAnnualPoints === 0)) return null;
  return sortedTiers(tiers);
}

/** The same, reached through a brand config's `loyalty` block. */
export function resolveRewardTiers(config: unknown): readonly RewardTier[] | null {
  if (typeof config !== 'object' || config === null) return null;
  const loyalty = (config as { loyalty?: unknown }).loyalty;
  if (typeof loyalty !== 'object' || loyalty === null) return null;
  return rewardTiersFrom((loyalty as { tiers?: unknown }).tiers);
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
