/** Pure meter math for LoyaltyMeter, reachable from node:test. */

export type LoyaltyProgress = {
  /** 0..1 fill toward the next reward. */
  fraction: number;
  pointsIntoTier: number;
  pointsToNext: number;
};

export function loyaltyProgress(balance: number, rewardEvery: number): LoyaltyProgress {
  if (!Number.isFinite(balance) || balance < 0 || !Number.isFinite(rewardEvery) || rewardEvery <= 0) {
    return { fraction: 0, pointsIntoTier: 0, pointsToNext: rewardEvery > 0 ? rewardEvery : 0 };
  }
  const into = balance % rewardEvery;
  return {
    fraction: into / rewardEvery,
    pointsIntoTier: into,
    pointsToNext: rewardEvery - into,
  };
}
