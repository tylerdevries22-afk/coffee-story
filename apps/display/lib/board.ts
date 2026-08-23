import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { fetchBoardTickets } from '@platform/data';
import type { BoardTicketRow } from '@platform/schema';

import { DEMO_BOARD, demoLocationName } from './demo-board';

/**
 * The display's read.
 *
 * A device token, not a session: a TV on a wall cannot sign anyone in, and the
 * token it holds is scoped to reading one location's board and nothing else
 * (migration 0022). Until a device is paired the app runs on fixtures, so the
 * screen can be reviewed and demoed with no infrastructure at all -- the same
 * bargain apps/hq makes with its own fixtures.
 */
function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.DISPLAY_DEVICE_TOKEN ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function isConfigured(): boolean {
  return client() !== null;
}

export async function loadBoardTickets(locationId: string): Promise<BoardTicketRow[]> {
  const db = client();
  if (!db) return DEMO_BOARD.map((ticket) => ({ ...ticket, location_id: locationId }));
  return fetchBoardTickets(db, locationId);
}

export async function loadLocationName(locationId: string): Promise<string> {
  const db = client();
  if (!db) return demoLocationName(locationId);
  const row = await db
    .from('locations')
    .select('name')
    .eq('id', locationId)
    .maybeSingle<{ name: string }>();
  return row.data?.name ?? 'Pickup';
}
