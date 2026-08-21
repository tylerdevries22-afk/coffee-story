import type { RewardCatalogItem } from '@/types/domain';

/** A tier perk as shown in the perk sheet. */
export type PerkDetail = {
  label: string;
  tier: string;
  description: string;
  locked: boolean;
};

/** A catalog reward plus whether the member can afford it yet. */
export type RewardDetail = {
  reward: RewardCatalogItem;
  locked: boolean;
};
