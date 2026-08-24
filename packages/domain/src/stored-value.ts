/**
 * How much of a total a stored-value balance covers.
 *
 * Promoted out of packages/engine because both sides need the SAME split and
 * the engine is service-role code a guest surface must not import. The engine
 * keeps `nextLedgerBalance`, which throws when a ledger would go negative --
 * that belongs on the server, where refusing is the right answer. This is the
 * arithmetic a screen also has to show.
 *
 * The order matters and is the reason this is shared rather than restated: the
 * balance is applied to the TOTAL, after tax, exactly as
 * `captureSquarePayment` computes `total_cents - stored_value_applied_cents`.
 * A screen that applied it to the subtotal would quote a different remainder
 * from the one the card is charged.
 */
export type StoredValueCoverage = {
  /** Taken from the balance. Never more than the balance or the total. */
  coveredCents: number;
  /** What a wire tender still has to settle. */
  remainderCents: number;
};

export function coverageFor(totalCents: number, balanceCents: number): StoredValueCoverage {
  const total = safeCents(totalCents);
  const balance = safeCents(balanceCents);
  const coveredCents = Math.min(total, balance);
  return { coveredCents, remainderCents: total - coveredCents };
}

/** Integer cents, never negative -- a balance cannot create money. */
function safeCents(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
