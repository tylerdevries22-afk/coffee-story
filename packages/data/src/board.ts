import type { SupabaseClient } from '@supabase/supabase-js';

import { readSnapshotLines, ticketCallout } from '@platform/domain';
import type { BoardTicketRow, OrderRow } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

export type OrderBoardEntry = {
  id: string;
  shortCode: string;
  guestName: string;
  status: OrderRow['status'];
  placedAt: string;
  dailyNumber: number | null;
  updatedAt: string;
  scheduledFor: string | null;
  lines: readonly {
    name: string;
    quantity: number;
    options: readonly string[];
    note?: string;
    packContents?: readonly { itemSlug: string; name: string; quantity: number }[];
  }[];
  totalCents: number;
  note: string;
  tenderType: OrderRow['tender_type'];
};

/** The one call-out every staff and guest surface uses. */
export function orderCallout(row: Pick<OrderRow, 'daily_number' | 'guest_label'>): string {
  return ticketCallout(row.daily_number, row.guest_label);
}

/** Maps the private staff row into the narrow KDS shape. */
export function orderBoardEntryFromRow(row: OrderRow): OrderBoardEntry {
  return {
    id: row.id,
    shortCode: orderCallout(row),
    guestName: row.guest_label?.trim() || 'Guest',
    status: row.status,
    placedAt: row.created_at,
    dailyNumber: row.daily_number,
    updatedAt: row.updated_at,
    scheduledFor: row.scheduled_for,
    lines: readSnapshotLines(row.totals).map((line) => ({
      name: line.name,
      quantity: line.quantity,
      options: line.options,
      note: line.note,
      packContents: line.packContents,
    })),
    totalCents: row.total_cents,
    note: row.note,
    tenderType: row.tender_type,
  };
}

/**
 * The pickup display's read.
 *
 * Goes through the `board_tickets` view rather than `orders`, because RLS is
 * row-level and cannot hide a column: a screen the whole room can see must not
 * be one query away from customer_id, the cart, or a total. The view simply
 * does not select them.
 *
 * Ordered by ticket number rather than time so the board reads like a queue.
 */
export async function fetchBoardTickets(
  client: SupabaseClient,
  locationId: string,
): Promise<BoardTicketRow[]> {
  const rows = await readWithRetry('fetchBoardTickets', (signal) => abortRead(client
    .from('board_tickets')
    .select('*')
    .eq('location_id', locationId)
    .order('daily_number', { ascending: true }), signal)
    .returns<BoardTicketRow[]>());
  return rows ?? [];
}
