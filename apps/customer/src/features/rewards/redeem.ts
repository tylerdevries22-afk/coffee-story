import type { RewardCatalogItem } from '@/types/domain';

export function rewardIsLocked(reward: RewardCatalogItem, availablePoints: number): boolean {
  return reward.pointsCost > availablePoints;
}

export function rewardFillPercent(availablePoints: number, pointsCost: number): number {
  if (pointsCost <= 0) return 1;
  return Math.min(Math.max(availablePoints, 0) / pointsCost, 1);
}

export function nextRewardForBalance(
  catalog: readonly RewardCatalogItem[],
  availablePoints: number,
): RewardCatalogItem | undefined {
  return [...catalog]
    .sort((left, right) => left.pointsCost - right.pointsCost)
    .find((reward) => reward.pointsCost > availablePoints);
}
