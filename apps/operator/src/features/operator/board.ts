/**
 * The live order board (KDS): rule 2's states arranged into the three
 * working columns, with a separate lane for orders scheduled further out.
 * Pure; the screen feeds it orders and a clock.
 */
import { BOARD_STATUSES, type OrderStatus } from '@platform/schema';
import type { OrderBoardEntry } from '@platform/data';

/** The KDS shape is owned by @platform/data so every live row is mapped once. */
export type BoardOrder = OrderBoardEntry;

/** Orders further out than this stay in the scheduled lane, not the board. */
export const SCHEDULED_LANE_MINUTES = 30;

export type BoardColumns = {
  paid: BoardOrder[];
  in_progress: BoardOrder[];
  ready: BoardOrder[];
  scheduled: BoardOrder[];
};

export function boardColumns(orders: readonly BoardOrder[], now: Date): BoardColumns {
  const columns: BoardColumns = { paid: [], in_progress: [], ready: [], scheduled: [] };
  const laneCutoff = now.getTime() + SCHEDULED_LANE_MINUTES * 60_000;
  for (const order of orders) {
    if (!(BOARD_STATUSES as readonly OrderStatus[]).includes(order.status)) continue;
    if (
      order.status === 'paid'
      && order.scheduledFor
      && new Date(order.scheduledFor).getTime() > laneCutoff
    ) {
      columns.scheduled.push(order);
      continue;
    }
    columns[order.status as (typeof BOARD_STATUSES)[number]].push(order);
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
  return orders.filter((order) => order.status === 'paid' && !previous.has(order.id)).map((order) => order.id);
}

/** The one action each column offers, in rule 2's machine. */
export function nextActionFor(status: OrderStatus): { to: OrderStatus; label: string } | null {
  switch (status) {
    case 'paid': return { to: 'in_progress', label: 'Start' };
    case 'in_progress': return { to: 'ready', label: 'Ready' };
    case 'ready': return { to: 'picked_up', label: 'Picked up' };
    default: return null;
  }
}
