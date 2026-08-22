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
  ['ready', 'refunded'],
  ['picked_up', 'refunded'],
] as const;

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

/** The states the operator's live board shows, in column order. */
export const BOARD_STATUSES = ['paid', 'in_progress', 'ready'] as const;

/** Terminal states. picked_up is not terminal: it can still be refunded. */
export function isTerminal(status: OrderStatus): boolean {
  return status === 'cancelled' || status === 'refunded';
}

/** What the operator app may write directly (RLS mirrors this list). */
export const OPERATOR_TRANSITIONS: readonly OrderStatus[] = [
  'in_progress',
  'ready',
  'picked_up',
  'cancelled',
] as const;
