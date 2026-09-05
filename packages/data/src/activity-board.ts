import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActivityBoardItemRow } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

/** Reads only the projection approved for a shared wall. */
export async function fetchActivityBoardItems(
  client: SupabaseClient,
  locationId: string,
): Promise<ActivityBoardItemRow[]> {
  const rows = await readWithRetry('fetchActivityBoardItems', (signal) => abortRead(client
    .from('activity_board_items')
    .select('*')
    .eq('location_id', locationId)
    .order('scheduled_for', { ascending: true }), signal)
    .returns<ActivityBoardItemRow[]>());
  return rows ?? [];
}
