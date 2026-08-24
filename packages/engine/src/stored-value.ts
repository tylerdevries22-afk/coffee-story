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

/**
 * The split moved to packages/domain so the kiosk can show the same arithmetic
 * the server applies -- a guest surface must not import this module, which is
 * service-role code. Re-exported here so existing callers are unchanged.
 */
export { coverageFor, type StoredValueCoverage } from '@platform/domain';
