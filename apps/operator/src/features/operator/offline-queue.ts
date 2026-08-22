/**
 * Status changes made while the connection is down, applied in order on
 * reconnect. Reconciliation drops moves the server state has made illegal
 * (someone else advanced or refunded the order first) instead of failing the
 * whole queue. Pure; persistence is the screen's storage adapter.
 */
import { canTransition, type OrderStatus } from '@platform/schema';

export type QueuedTransition = {
  orderId: string;
  to: OrderStatus;
  queuedAt: string; // ISO
};

export function enqueueTransition(
  queue: readonly QueuedTransition[],
  transition: QueuedTransition,
): QueuedTransition[] {
  // A newer decision about the same order replaces the older one -- sending
  // both would replay a stale move after the fresh one.
  return [...queue.filter((entry) => entry.orderId !== transition.orderId), transition];
}

export type Reconciliation = {
  /** Apply these, in order. */
  apply: QueuedTransition[];
  /** Dropped because the server has moved on; surface, do not retry. */
  conflicts: { transition: QueuedTransition; serverStatus: OrderStatus | null }[];
};

export function reconcileQueue(
  queue: readonly QueuedTransition[],
  serverStatus: ReadonlyMap<string, OrderStatus>,
): Reconciliation {
  const apply: QueuedTransition[] = [];
  const conflicts: Reconciliation['conflicts'] = [];
  for (const transition of queue) {
    const current = serverStatus.get(transition.orderId) ?? null;
    if (current === transition.to) continue; // already there: idempotent, silent
    if (current !== null && canTransition(current, transition.to)) {
      apply.push(transition);
    } else {
      conflicts.push({ transition, serverStatus: current });
    }
  }
  return { apply, conflicts };
}
