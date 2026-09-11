import { REWARD_TIERS, sortedTiers, type RewardTier } from './rules';
import { slugify } from './slug';

/** A rung of the ladder as a wall screen shows it. */
export type BoardTier = {
  slug: string;
  label: string;
  minLifetimePoints: number;
  tone: TierTone;
  color: string | null;
  icon: string | null;
};

export type TierTone = 'muted' | 'accent' | 'success' | 'primary';

export const TIER_TONES: readonly TierTone[] = ['muted', 'accent', 'success', 'primary'];

/** A tier name reduced to a key the database can hold and match on. */
export function tierSlug(name: string): string {
  return slugify(name, 64);
}

/** The board's rungs, derived from the brand's earn ladder. */
export function boardLadderFrom(tiers: readonly RewardTier[] = REWARD_TIERS): readonly BoardTier[] {
  return sortedTiers(tiers.length > 0 ? tiers : REWARD_TIERS).map((tier, index) => ({
    slug: tierSlug(tier.name) || `tier-${index}`,
    label: tier.name,
    minLifetimePoints: Math.max(0, Math.round(tier.minimumAnnualPoints)),
    tone: TIER_TONES[Math.min(index, TIER_TONES.length - 1)] ?? 'muted',
    color: null,
    icon: null,
  }));
}

/** The ladder a brand gets before it configures one. */
export const DEFAULT_TIER_LADDER: readonly BoardTier[] = boardLadderFrom();

/** The highest rung reached, or null below the first rung. */
export function tierFor(
  lifetimePoints: number,
  ladder: readonly BoardTier[] = DEFAULT_TIER_LADDER,
): BoardTier | null {
  if (!Number.isFinite(lifetimePoints) || lifetimePoints < 0) return null;
  let reached: BoardTier | null = null;
  for (const tier of ladder) {
    if (tier.minLifetimePoints <= lifetimePoints) reached = tier;
  }
  return reached;
}

/** The ladder rung a `board_tickets.loyalty_tier` slug names, or null. */
export function tierBySlug(
  slug: string | null | undefined,
  ladder: readonly BoardTier[] = DEFAULT_TIER_LADDER,
): BoardTier | null {
  if (!slug) return null;
  return ladder.find((tier) => tier.slug === slug) ?? null;
}
