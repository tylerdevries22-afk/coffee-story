/**
 * Rule 2's lifecycle, shared by the engine, both apps, and the SQL trigger.
 *
 * The authoritative copy is `migrations/0005_orders.sql`
 * (`app.order_transition_allowed`); `order-status.test.ts` reads that file
 * and fails if this table and the SQL ever disagree.
 */
export const ORDER_STATUSES = [
  'created',
  'paid',
  'in_progress',
  'ready',
  'picked_up',
  'cancelled',
  'refunded',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: readonly (readonly [OrderStatus, OrderStatus])[] = [
  ['created', 'paid'],
  ['created', 'cancelled'],
  ['paid', 'in_progress'],
  ['paid', 'cancelled'],
  ['paid', 'refunded'],
  ['in_progress', 'ready'],
  ['in_progress', 'cancelled'],
  ['in_progress', 'refunded'],
  ['ready', 'picked_up'],
  // A drink nobody collects: pay_at_pickup never charged a card, so refunding
  // it is not an option and this was the only way off the board (0021).
  ['ready', 'cancelled'],
  ['ready', 'refunded'],
  ['picked_up', 'refunded'],
] as const;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

/**
 * The shortest legal run of transitions from one state to another, or null
 * when the machine offers no route.
 *
 * The board advances one tap at a time, but a queue does not: a barista who
 * taps Start then Ready with no connection produces one queued intent to
 * reach `ready` from an order the server still has at `paid` — and paid does
 * not reach ready in a single move. Expanding it here replays the work the
 * barista actually did, rather than dropping it as an illegal transition.
 *
 * Breadth-first, so 'paid' -> 'refunded' stays the direct edge rather than
 * wandering through in_progress.
 */
export function transitionPath(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  if (from === to) return [];
  const queue: OrderStatus[][] = [[from]];
  const seen = new Set<OrderStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const tail = path[path.length - 1]!;
    for (const [a, b] of ORDER_TRANSITIONS) {
      if (a !== tail || seen.has(b)) continue;
      if (b === to) return [...path.slice(1), b];
      seen.add(b);
      queue.push([...path, b]);
    }
  }
  return null;
}

/** The states the operator's live board shows, in column order. */
export const BOARD_STATUSES = ['paid', 'in_progress', 'ready'] as const;

/** Terminal states. picked_up is not terminal: it can still be refunded. */
export function isTerminal(status: OrderStatus): boolean {
  return status === 'cancelled' || status === 'refunded';
}

/**
 * What the operator app may write directly (RLS mirrors this list).
 * `paid` is here for the pay_at_pickup tender: the shop floor asserts payment
 * at handoff when no processor was involved.
 */
export const OPERATOR_TRANSITIONS: readonly OrderStatus[] = [
  'paid',
  'in_progress',
  'ready',
  'picked_up',
  'cancelled',
] as const;
