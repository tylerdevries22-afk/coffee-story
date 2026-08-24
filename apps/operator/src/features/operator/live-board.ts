import type { BoardOrder } from './board';

/** Upsert one realtime row into the board list (replace or append). */
export function upsertBoardOrder(orders: readonly BoardOrder[], next: BoardOrder): BoardOrder[] {
  const index = orders.findIndex((order) => order.id === next.id);
  if (index < 0) return [...orders, next];
  const copy = [...orders];
  copy[index] = next;
  return copy;
}
