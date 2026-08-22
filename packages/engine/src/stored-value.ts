/**
 * Stored value (gift balance) arithmetic. The ledger is append-only with
 * balance_after_cents on every row; these helpers make the next row.
 */
export type LedgerEntryInput = {
  type: 'load' | 'spend' | 'refund' | 'adjust' | 'gift_received';
  amountCents: number;   // signed: spend is negative
};

export function nextLedgerBalance(currentBalanceCents: number, entry: LedgerEntryInput): number {
  const next = currentBalanceCents + entry.amountCents;
  if (next < 0) {
    throw new Error(
      `Stored-value ledger would go negative (${currentBalanceCents} + ${entry.amountCents}); ` +
      'spends must be capped at the balance before they reach the ledger.',
    );
  }
  return next;
}

/** How much of a total the balance can cover; the split the checkout applies. */
export function coverageFor(totalCents: number, balanceCents: number): { coveredCents: number; remainderCents: number } {
  const covered = Math.max(0, Math.min(Math.trunc(totalCents), Math.trunc(balanceCents)));
  return { coveredCents: covered, remainderCents: Math.max(0, Math.trunc(totalCents) - covered) };
}
