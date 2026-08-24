/**
 * The live order board (KDS): rule 2's states arranged into the three
 * working columns, with a separate lane for orders scheduled further out.
 * Pure; the screen feeds it orders and a clock.
 */
import { BOARD_STATUSES, type OrderStatus } from '@platform/schema';
import type { OrderBoardEntry } from '@platform/data';

/** The KDS shape is owned by @platform/data so every live row is mapped once. */
export type BoardOrder = OrderBoardEntry;

/** Fulfillment copy for one structured pack recipe. */
export function packContentsLabel(
  contents: readonly { name: string; quantity: number }[],
): string | null {
  if (contents.length === 0) return null;
  return `Inside each box: ${contents.map((content) => `${content.quantity}× ${content.name}`).join(' · ')}`;
}

/** Orders further out than this stay in the scheduled lane, not the board. */
export const SCHEDULED_LANE_MINUTES = 30;

export type BoardColumns = {
  paid: BoardOrder[];
  in_progress: BoardOrder[];
  ready: BoardOrder[];
  scheduled: BoardOrder[];
};

export function isPaymentDue(order: Pick<BoardOrder, 'status' | 'tenderType'>): boolean {
  return order.status === 'created' && order.tenderType === 'pay_at_pickup';
}

/** Only money that has not moved may take the direct cancellation path. */
export function canCancelWithoutRefund(
  order: Pick<BoardOrder, 'status' | 'tenderType'>,
): boolean {
  return isPaymentDue(order);
}

export function boardColumns(orders: readonly BoardOrder[], now: Date): BoardColumns {
  const columns: BoardColumns = { paid: [], in_progress: [], ready: [], scheduled: [] };
  const laneCutoff = now.getTime() + SCHEDULED_LANE_MINUTES * 60_000;
  for (const order of orders) {
    const paymentDue = isPaymentDue(order);
    if (!(BOARD_STATUSES as readonly OrderStatus[]).includes(order.status) && !paymentDue) continue;
    if (
      (order.status === 'paid' || paymentDue)
      && order.scheduledFor
      && new Date(order.scheduledFor).getTime() > laneCutoff
    ) {
      columns.scheduled.push(order);
      continue;
    }
    if (paymentDue) columns.paid.push(order);
    else columns[order.status as (typeof BOARD_STATUSES)[number]].push(order);
  }
  // Oldest first inside a column -- the queue the bar actually works.
  const byAge = (a: BoardOrder, b: BoardOrder) =>
    new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime();
  columns.paid.sort(byAge);
  columns.in_progress.sort(byAge);
  columns.ready.sort(byAge);
  columns.scheduled.sort(
    (a, b) => new Date(a.scheduledFor ?? a.placedAt).getTime() - new Date(b.scheduledFor ?? b.placedAt).getTime(),
  );
  return columns;
}

/** Ids present now that were not before: what the new-order alert fires for. */
export function newOrderIds(previous: ReadonlySet<string>, orders: readonly BoardOrder[]): string[] {
  return orders
    .filter((order) => (order.status === 'paid' || isPaymentDue(order)) && !previous.has(order.id))
    .map((order) => order.id);
}

/** The one action each column offers, in rule 2's machine. */
export function nextActionFor(
  value: OrderStatus | Pick<BoardOrder, 'status' | 'tenderType'>,
): { to: OrderStatus; label: string } | null {
  if (typeof value !== 'string' && isPaymentDue(value)) return { to: 'paid', label: 'Mark paid' };
  const status = typeof value === 'string' ? value : value.status;
  switch (status) {
    case 'paid': return { to: 'in_progress', label: 'Start' };
    case 'in_progress': return { to: 'ready', label: 'Ready' };
    case 'ready': return { to: 'picked_up', label: 'Picked up' };
    default: return null;
  }
}
