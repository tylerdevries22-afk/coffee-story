import { cashDeltaForEntry } from '@/features/rewards/presentation';
import type { RewardEntry } from '@platform/domain';

export type CashEntry = { entry: RewardEntry; delta: number };

export function cashEntries(ledger: readonly RewardEntry[]): CashEntry[] {
  return ledger
    .map((entry) => ({ entry, delta: cashDeltaForEntry(entry) }))
    .filter((item): item is CashEntry => item.delta !== null);
}
