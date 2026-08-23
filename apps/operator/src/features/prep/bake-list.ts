import type { PrepStatus } from '@platform/schema';

/**
 * The bench's view of a batch.
 *
 * Kept structural rather than importing PrepBatchRow: the station runs on demo
 * data today and live rows after C1, and the screen should not care which.
 */
export type BakeBatch = {
  id: string;
  itemName: string;
  targetQty: number;
  producedQty: number;
  status: PrepStatus;
  /** Allergens on the recipe, surfaced as a pinned banner. */
  allergens: readonly string[];
  yieldQty: number;
  yieldUnit: string;
};

/**
 * The order a bake list is worked in.
 *
 * In progress first, because a tray already in the oven is the thing most
 * likely to need looking at; then pending, largest target first, because a
 * bigger batch needs starting sooner to be out on time; then everything
 * finished, which is a record rather than a task.
 */
const RANK: Readonly<Record<PrepStatus, number>> = {
  in_progress: 0,
  pending: 1,
  done: 2,
  abandoned: 3,
};

export function sortBakeList(batches: readonly BakeBatch[]): BakeBatch[] {
  return [...batches].sort((a, b) => {
    const rank = RANK[a.status] - RANK[b.status];
    if (rank !== 0) return rank;
    if (a.status === 'pending') return b.targetQty - a.targetQty;
    return a.itemName.localeCompare(b.itemName);
  });
}

/** How far through the day's baking the shift is, for the header. */
export function bakeProgress(batches: readonly BakeBatch[]): { done: number; total: number } {
  const counted = batches.filter((b) => b.status !== 'abandoned');
  return { done: counted.filter((b) => b.status === 'done').length, total: counted.length };
}

/**
 * A step's quantity, scaled to the batch actually being made.
 *
 * Returns both numbers rather than replacing one with the other. A baker
 * doubling a tray needs to see the recipe's own figure beside the scaled one,
 * because a silently-rewritten quantity cannot be checked against the card on
 * the wall -- and the card is what they will reach for when the tablet sleeps.
 */
export type ScaledQuantity = { recipe: number; batch: number; multiplier: number };

export function scaleQuantity(
  recipeQty: number,
  batch: Pick<BakeBatch, 'targetQty' | 'yieldQty'>,
): ScaledQuantity {
  const multiplier = batch.yieldQty > 0 ? batch.targetQty / batch.yieldQty : 1;
  return {
    recipe: recipeQty,
    // Two decimals: a third would imply a precision no kitchen scale has.
    batch: Math.round(recipeQty * multiplier * 100) / 100,
    multiplier,
  };
}

/** "x2" / "x1.5" / "" when the batch is exactly one recipe. */
export function multiplierLabel(multiplier: number): string {
  if (Math.abs(multiplier - 1) < 0.005) return '';
  const rounded = Math.round(multiplier * 100) / 100;
  return `x${rounded}`;
}
