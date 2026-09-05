import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { fetchActivityBoardItems, fetchBoardTickets } from '@platform/data';
import type { ActivityBoardItemRow, BoardTicketRow } from '@platform/schema';

import { deviceToken, deviceTokenConfigured } from './device-token';

import {
  demoSyncClient, synchronizedFixtureTickets, synchronizedPreview,
} from './board-demo-sync';
import {
  fixtureBoardSnapshot, liveBoardSnapshot, loadBrandBits, unpairedBoardSnapshot,
  type BoardSnapshot,
} from './board-snapshot';
import { demoActivityItems, selectedDemoTenantKind } from './demo-tenant';

export { previewWallEnabled, synchronizedFixtureTickets } from './board-demo-sync';
export type { BoardSnapshot } from './board-snapshot';

/**
 * The display's read.
 *
 * A device token, not a session: a TV on a wall cannot sign anyone in, and the
 * token it holds is scoped to reading one location's board and nothing else
 * (migrations 0022 and 0030). Until a device is paired the app runs on
 * fixtures, so the screen can be reviewed and demoed with no infrastructure at
 * all -- the same bargain apps/hq makes with its own fixtures.
 *
 * Every read here is server-side. The browser on the wall never holds a
 * Supabase credential, which is the point: that browser sits in a public room
 * where anyone can open devtools, and a token it does not have is a token
 * nobody can lift.
 */
/**
 * The device token, and only the device token.
 *
 * This used to fall back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which was
 * harmless while `board_tickets` was `security_invoker` and became a silent
 * failure the moment 0033 gated the view on `app.can_read_board`. The anon key
 * carries no device claim and no staff role, so it satisfies the gate for
 * nothing: the read succeeds, returns zero rows, and the board renders an
 * empty queue with a green "Live" chip beside it.
 *
 * That is the worst shape a failure can take on this surface. A shop with a
 * queue of eight sees a board confidently reporting nobody is waiting, and
 * every signal the screen has says it is working. Falling back to fixtures
 * instead makes a misconfiguration look like what it is.
 *
 * Found by the session working device pairing, whose 0038 issues the real
 * tokens this now requires.
 */
async function client(): Promise<SupabaseClient | null> {
  if (synchronizedPreview) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // DISPLAY_DEVICE_TOKEN, or a token derived from the refresh secret when one
  // is configured. Never the anon key, for the reason above.
  const key = await deviceToken();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Whether this screen has a credential at all.
 *
 * Stays synchronous, and deliberately does not mint a token: the callers are
 * route guards deciding between the board and the unpaired screen, and making
 * that decision depend on a network round trip would turn a slow HQ into a
 * screen that claims it was never paired.
 */
export function isConfigured(): boolean {
  return !synchronizedPreview && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
    && deviceTokenConfigured();
}

/**
 * Whether this deployment may draw invented guests.
 *
 * The fixtures exist so the screen can be reviewed and demoed with no
 * infrastructure. On a laptop that is the whole point; on a wall in a shop it
 * is a liability -- an unpaired production display would fall back to them and
 * put "Marguerite Vandersteen" and five other fabricated names on a screen the
 * room can read, indistinguishable from the real queue except that nobody in
 * the room is holding those orders.
 *
 * So a production build never invents anyone. It shows an unpaired screen and
 * says so, which is a state a passing manager can act on. A deployment that
 * genuinely wants the demo -- a trade stand, a sales call -- opts in.
 */
export function demoAllowed(): boolean {
  if (process.env.DISPLAY_DEMO_MODE === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

/**
 * A location id is a uuid or it is nothing.
 *
 * `/board/<anything>` used to go straight into `.eq('location_id', …)`, and
 * Postgres answered a non-uuid with error 22P02 -- which surfaced as a 500 and
 * a Next error page, on a screen bolted to a wall, until somebody noticed.
 * Rejecting the shape here turns a typo into an honest 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLocationId(value: string): boolean {
  return UUID.test(value);
}

/**
 * Never throws.
 *
 * Nobody is watching this screen for a stack trace, and a Next error page in
 * a shop window is a worse outcome than a stale board -- so a failed read
 * degrades to the last shape the board can honestly draw and says so in the
 * header, rather than taking the whole surface down.
 */
export async function loadBoard(locationId: string): Promise<BoardSnapshot> {
  const db = await client();
  if (!db) {
    if (!demoAllowed()) return unpairedBoardSnapshot();
    try {
      const tickets = await synchronizedFixtureTickets(locationId);
      return fixtureBoardSnapshot(locationId, false, demoSyncClient !== null, tickets);
    } catch {
      return fixtureBoardSnapshot(locationId, demoSyncClient !== null, demoSyncClient !== null);
    }
  }

  try {
    const [tickets, activityItems, brand] = await Promise.all([
      fetchBoardTickets(db, locationId),
      fetchActivityBoardItems(db, locationId),
      loadBrandBits(db, locationId),
    ]);
    return liveBoardSnapshot(brand, tickets, activityItems);
  } catch (error) {
    console.error('display: board read failed', error);
    // Degraded, not demo: a failed read on a paired screen must not start
    // inventing guests either.
    return { ...unpairedBoardSnapshot(), degraded: true, unpaired: false };
  }
}

/**
 * The reconcile read: tickets only, since nothing else changes mid-shift.
 *
 * On fixtures this answers from the demo cycle rather than a frozen array, so
 * the heartbeat and reconcile run for real with no database
 * behind them. A demo that skips those is a demo that cannot show the board
 * working, and cannot catch it when it stops.
 */
export async function loadBoardTickets(locationId: string): Promise<BoardTicketRow[]> {
  const db = await client();
  if (!db) {
    if (!demoAllowed()) return [];
    if (selectedDemoTenantKind() !== 'default') return [];
    return synchronizedFixtureTickets(locationId);
  }
  return fetchBoardTickets(db, locationId);
}

/** The activity reconcile read, using the same safe projection as first paint. */
export async function loadActivityBoardItems(locationId: string): Promise<ActivityBoardItemRow[]> {
  const db = await client();
  if (!db) {
    if (!demoAllowed()) return [];
    return demoActivityItems(Date.now(), locationId);
  }
  return fetchActivityBoardItems(db, locationId);
}
