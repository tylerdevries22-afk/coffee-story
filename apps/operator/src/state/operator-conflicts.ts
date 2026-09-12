/**
 * The board's running log of transitions that did not land: a refund the
 * gateway rejected, a cancel Square already moved past, a queued advance the
 * server disagreed with. Every failure on this list used to go straight into
 * `setConflicts` with nothing downstream ever reading it, so a barista had no
 * way to know money was not actually refunded. Giving each entry a stable id
 * lets the board render them as a dismissable banner instead of a state that
 * only ever grew.
 */
export type OperatorConflict = {
  id: string;
  orderId: string;
  message: string;
};

let sequence = 0;

/** Timestamp plus a counter: unique within a session even when two failures
 * land in the same millisecond. */
function nextConflictId(): string {
  sequence += 1;
  return `conflict-${Date.now()}-${sequence}`;
}

export function appendConflicts(
  existing: readonly OperatorConflict[],
  entries: readonly { orderId: string; message: string }[],
): OperatorConflict[] {
  return [...existing, ...entries.map((entry) => ({ id: nextConflictId(), ...entry }))];
}

export function appendConflict(
  existing: readonly OperatorConflict[],
  orderId: string,
  message: string,
): OperatorConflict[] {
  return appendConflicts(existing, [{ orderId, message }]);
}

export function dismissConflict(
  existing: readonly OperatorConflict[],
  id: string,
): OperatorConflict[] {
  return existing.filter((conflict) => conflict.id !== id);
}
