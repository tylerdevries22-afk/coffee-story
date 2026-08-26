import { ORDER_STATUSES, transitionPath, type OrderStatus } from '@platform/schema';

import { enqueueTransition, type QueuedTransition } from './offline-queue';

export type QueueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type ApplyTransitionResult =
  | { outcome: 'confirmed' }
  | { outcome: 'retry' }
  | { outcome: 'rejected'; message: string };

const VERSION = 1;
function key(locationId: string): string {
  return `platform:operator-transition-queue:${locationId}`;
}

function isTransition(value: unknown): value is QueuedTransition {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<QueuedTransition>;
  return typeof row.orderId === 'string'
    && typeof row.queuedAt === 'string'
    && ORDER_STATUSES.includes(row.to as OrderStatus);
}

/** Corrupt or older storage degrades to an empty queue, never a crashed KDS. */
export async function loadTransitionQueue(
  storage: QueueStorage,
  locationId: string,
): Promise<QueuedTransition[]> {
  try {
    const stored = await storage.getItem(key(locationId));
    if (!stored) return [];
    const parsed = JSON.parse(stored) as { version?: unknown; items?: unknown };
    if (parsed.version !== VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter(isTransition);
  } catch {
    return [];
  }
}

/** Returns false when storage is unavailable; the in-memory queue still runs. */
export async function saveTransitionQueue(
  storage: QueueStorage,
  locationId: string,
  queue: readonly QueuedTransition[],
): Promise<boolean> {
  try {
    if (queue.length === 0) await storage.removeItem(key(locationId));
    else await storage.setItem(key(locationId), JSON.stringify({ version: VERSION, items: queue }));
    return true;
  } catch {
    return false;
  }
}

export type QueueDrain = {
  remaining: QueuedTransition[];
  conflicts: { transition: QueuedTransition; serverStatus: OrderStatus | null; message: string }[];
};

function sameTransition(left: QueuedTransition, right: QueuedTransition): boolean {
  return left.orderId === right.orderId && left.to === right.to && left.queuedAt === right.queuedAt;
}

/** Every non-empty batch needs an authoritative read before it is drained. */
export function transitionQueueNeedsRefresh(
  queue: readonly QueuedTransition[],
): boolean {
  return queue.length > 0;
}

/** Refresh queued orders without letting a read outage consume or reject the queue. */
export async function refreshTransitionStatuses(
  queue: readonly QueuedTransition[],
  serverStatus: ReadonlyMap<string, OrderStatus>,
  load: () => Promise<readonly { id: string; status: OrderStatus }[]>,
): Promise<Map<string, OrderStatus> | null> {
  const refreshed = new Map(serverStatus);
  if (!transitionQueueNeedsRefresh(queue)) return refreshed;
  try {
    const orders = await load();
    refreshed.clear();
    for (const order of orders) refreshed.set(order.id, order.status);
    return refreshed;
  } catch {
    return null;
  }
}

export class QueueOperationTimeoutError extends Error {
  constructor() {
    super('The queued operation timed out.');
    this.name = 'QueueOperationTimeoutError';
  }
}

/** Abort and release a queue operation that does not settle by its deadline. */
export async function runQueueOperation<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new QueueOperationTimeoutError());
      controller.abort();
    }, Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Fixture actions stay local and cannot consume an outstanding broker intent. */
export function enqueueSharedTransition(
  queue: readonly QueuedTransition[],
  transition: QueuedTransition,
  synchronized: boolean,
): QueuedTransition[] {
  return synchronized ? enqueueTransition(queue, transition) : [...queue];
}

/** Apply a drain result without discarding decisions enqueued while network work was pending. */
export function finalizeTransitionDrain(
  current: readonly QueuedTransition[],
  started: readonly QueuedTransition[],
  remaining: readonly QueuedTransition[],
): QueuedTransition[] {
  const startedByOrder = new Map(started.map((entry) => [entry.orderId, entry]));
  const retryIds = new Set(remaining.map((entry) => entry.orderId));
  return current.filter((entry) => {
    const original = startedByOrder.get(entry.orderId);
    return !original || !sameTransition(entry, original) || retryIds.has(entry.orderId);
  });
}

/**
 * Removes an intent only after every required event insert is confirmed.
 * If one hop succeeds and the next loses the network, the original target is
 * retained; the next server read computes the shorter remaining path.
 */
export async function drainTransitionQueue(
  queue: readonly QueuedTransition[],
  serverStatus: ReadonlyMap<string, OrderStatus>,
  apply: (transition: QueuedTransition) => Promise<ApplyTransitionResult>,
): Promise<QueueDrain> {
  const remaining: QueuedTransition[] = [];
  const conflicts: QueueDrain['conflicts'] = [];
  for (const intent of queue) {
    const current = serverStatus.get(intent.orderId) ?? null;
    if (current === intent.to) continue;
    const path = current === null ? null : transitionPath(current, intent.to);
    if (!path || path.length === 0) {
      conflicts.push({ transition: intent, serverStatus: current, message: 'Order moved elsewhere.' });
      continue;
    }
    let retry = false;
    for (const step of path) {
      const result = await apply({ ...intent, to: step });
      if (result.outcome === 'confirmed') continue;
      if (result.outcome === 'retry') retry = true;
      else conflicts.push({ transition: intent, serverStatus: current, message: result.message });
      break;
    }
    if (retry) remaining.push(intent);
  }
  return { remaining, conflicts };
}
