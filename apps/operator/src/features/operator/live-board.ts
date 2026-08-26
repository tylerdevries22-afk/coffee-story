import type { BoardOrder } from './board';

/** Match the live row projection when an optional counter name is blank. */
export function normalizeBoardOrderGuest(order: BoardOrder): BoardOrder {
  const guestName = order.guestName.trim() || 'Guest';
  return guestName === order.guestName ? order : { ...order, guestName };
}

/** Upsert one realtime row into the board list (replace or append). */
export function upsertBoardOrder(orders: readonly BoardOrder[], next: BoardOrder): BoardOrder[] {
  const index = orders.findIndex((order) => order.id === next.id);
  if (index < 0) return [...orders, next];
  const copy = [...orders];
  copy[index] = next;
  return copy;
}
