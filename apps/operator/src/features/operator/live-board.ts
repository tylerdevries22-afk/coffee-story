/**
 * OrderRow -> BoardOrder: what the live plane's rows look like on the KDS.
 * Pure, so the mapping (and the short-code rule the barista calls out) is
 * unit-tested without a database.
 */
import type { OrderRow } from '@platform/schema';

import type { BoardOrder } from './board';

type SnapshotLine = {
  name?: string;
  quantity?: number;
  options?: string[];
};

/**
 * "A17": stable per order id, so every screen (and the guest's confirmation,
 * eventually) derives the same call-out from the id alone. Letter + two
 * digits gives 2,600 codes — collisions on one day's board are unlikely, and
 * harmless (the name is next to it).
 */
export function shortCodeOf(orderId: string): string {
  let hash = 0;
  for (const char of orderId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const letter = String.fromCharCode(65 + (hash % 26));
  const digits = String(Math.floor(hash / 26) % 100).padStart(2, '0');
  return `${letter}${digits}`;
}

export function boardOrderFromRow(row: OrderRow, guestName: string): BoardOrder {
  const totals = (row.totals ?? {}) as { lines?: SnapshotLine[] };
  return {
    id: row.id,
    shortCode: shortCodeOf(row.id),
    guestName,
    status: row.status,
    placedAt: row.created_at,
    scheduledFor: row.scheduled_for,
    lines: (totals.lines ?? []).map((line) => ({
      name: line.name ?? 'Item',
      quantity: line.quantity ?? 1,
      options: line.options ?? [],
    })),
    totalCents: row.total_cents,
    note: row.note,
  };
}

/** Upsert one realtime row into the board list (replace or append). */
export function upsertBoardOrder(orders: readonly BoardOrder[], next: BoardOrder): BoardOrder[] {
  const index = orders.findIndex((order) => order.id === next.id);
  if (index < 0) return [...orders, next];
  const copy = [...orders];
  // Realtime payloads carry the row, not the customer join; keep the name we
  // already resolved rather than blanking it.
  copy[index] = { ...next, guestName: next.guestName || copy[index]!.guestName };
  return copy;
}
