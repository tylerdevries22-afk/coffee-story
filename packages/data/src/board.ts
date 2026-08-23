import type { SupabaseClient } from '@supabase/supabase-js';

import type { BoardTicketRow } from '@platform/schema';

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
  const result = await client
    .from('board_tickets')
    .select('*')
    .eq('location_id', locationId)
    .order('daily_number', { ascending: true })
    .returns<BoardTicketRow[]>();
  if (result.error) throw new Error(`fetchBoardTickets: ${result.error.message}`);
  return result.data ?? [];
}

export type BoardColumns = {
  inProgress: BoardTicketRow[];
  ready: BoardTicketRow[];
};

/**
 * Splits the board the way a display shows it.
 *
 * 'paid' sits with in-progress: from a guest's side of the counter an order
 * that is paid for but not started yet is simply not ready, and a third column
 * saying so would be a column of noise.
 */
export function splitBoard(tickets: readonly BoardTicketRow[]): BoardColumns {
  return {
    inProgress: tickets.filter((t) => t.status === 'paid' || t.status === 'in_progress'),
    ready: tickets.filter((t) => t.status === 'ready'),
  };
}
