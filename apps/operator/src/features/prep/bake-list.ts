import type { PrepBoardEntry } from '@platform/data';
import type { PrepStatus } from '@platform/schema';

export type RecipeStep = {
  n: number;
  text: string;
  quantity?: number;
  unit?: string;
  minutes?: number;
};

/** Tolerant read of the versioned recipe JSON stored on PrepBoardEntry. */
export function recipeSteps(value: unknown): RecipeStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const row = candidate as Record<string, unknown>;
    if (!Number.isInteger(row.n) || typeof row.text !== 'string' || !row.text.trim()) return [];
    return [{
      n: row.n as number,
      text: row.text.trim(),
      ...(typeof row.quantity === 'number' && Number.isFinite(row.quantity) ? { quantity: row.quantity } : {}),
      ...(typeof row.unit === 'string' && row.unit.trim() ? { unit: row.unit.trim() } : {}),
      ...(typeof row.minutes === 'number' && Number.isFinite(row.minutes) ? { minutes: row.minutes } : {}),
    }];
  });
}

const RANK: Readonly<Record<PrepStatus, number>> = {
  in_progress: 0,
  pending: 1,
  done: 2,
  abandoned: 3,
};

/** Work in progress first, then largest pending batch, then completed work. */
export function sortBakeList(batches: readonly PrepBoardEntry[]): PrepBoardEntry[] {
  return [...batches].sort((a, b) => {
    const rank = RANK[a.status] - RANK[b.status];
    if (rank !== 0) return rank;
    if (a.status === 'pending') return b.target_qty - a.target_qty;
    return a.itemName.localeCompare(b.itemName);
  });
}

/** How far through the day's baking the shift is, for the header. */
export function bakeProgress(batches: readonly PrepBoardEntry[]): { done: number; total: number } {
  const counted = batches.filter((batch) => batch.status !== 'abandoned');
  return {
    done: counted.filter((batch) => batch.status === 'done').length,
    total: counted.length,
  };
}

/** "x2" / "x1.5" / "" when the batch is exactly one recipe. */
export function multiplierLabel(multiplier: number): string {
  if (Math.abs(multiplier - 1) < 0.005) return '';
  const rounded = Math.round(multiplier * 100) / 100;
  return `x${rounded}`;
}
