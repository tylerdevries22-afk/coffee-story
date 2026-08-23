import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { fetchBoardTickets } from '@platform/data';
import { resolveBoardConfig, type BoardConfig } from '@platform/domain';
import type { BoardTicketRow } from '@platform/schema';
import { resolveCopy, type BrandCopy } from '@platform/ui/copy';

import { DEMO_BRAND_CONFIG, demoBoardAt, demoLocationName } from './demo-board';
import { displayTheme, type DisplayTheme } from './theme';

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
function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.DISPLAY_DEVICE_TOKEN ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function isConfigured(): boolean {
  return client() !== null;
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
 * Everything one board needs, in the shape the screen draws.
 *
 * Assembled server-side in one pass so the page has no waterfall: a display
 * reboots to a cold cache every morning and the first paint is the one the
 * room sees.
 */
export type BoardSnapshot = {
  locationName: string;
  tickets: BoardTicketRow[];
  config: BoardConfig;
  copy: BrandCopy;
  theme: DisplayTheme;
  /** False when the deployment has no database; the board then runs on fixtures. */
  live: boolean;
  /** True when a live read failed and the board is showing what it last knew. */
  degraded: boolean;
};

type BrandBits = { name: string; config: unknown };

async function loadBrandBits(db: SupabaseClient, locationId: string): Promise<BrandBits | null> {
  const location = await db
    .from('locations')
    .select('name, brand_id')
    .eq('id', locationId)
    .maybeSingle<{ name: string; brand_id: string }>();
  if (location.error) throw new Error(`location: ${location.error.message}`);
  if (!location.data) return null;

  // brand_storefront, not brands: the table also carries the platform's fee
  // terms, which stay claim-gated (0015). A wall screen has no business
  // holding a query that could ever return them.
  const brand = await db
    .from('brand_storefront')
    .select('brand_config')
    .eq('id', location.data.brand_id)
    .maybeSingle<{ brand_config: unknown }>();
  if (brand.error) throw new Error(`brand: ${brand.error.message}`);
  return { name: location.data.name, config: brand.data?.brand_config ?? {} };
}

function fixtures(locationId: string, degraded: boolean): BoardSnapshot {
  return {
    locationName: demoLocationName(locationId),
    tickets: demoBoardAt(Date.now(), locationId),
    config: resolveBoardConfig(DEMO_BRAND_CONFIG),
    copy: resolveCopy((DEMO_BRAND_CONFIG as { copy?: unknown }).copy),
    theme: displayTheme(DEMO_BRAND_CONFIG),
    live: false,
    degraded,
  };
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
  const db = client();
  if (!db) return fixtures(locationId, false);

  try {
    const [tickets, brand] = await Promise.all([
      fetchBoardTickets(db, locationId),
      loadBrandBits(db, locationId),
    ]);
    return {
      locationName: brand?.name ?? 'Pickup',
      tickets,
      config: resolveBoardConfig(brand?.config),
      copy: resolveCopy((brand?.config as { copy?: unknown } | undefined)?.copy),
      theme: displayTheme(brand?.config),
      live: true,
      degraded: false,
    };
  } catch (error) {
    console.error('display: board read failed', error);
    return { ...fixtures(locationId, true), tickets: [] };
  }
}

/**
 * The reconcile read: tickets only, since nothing else changes mid-shift.
 *
 * On fixtures this answers from the demo cycle rather than a frozen array, so
 * the poll, the reconcile and the linger all run for real with no database
 * behind them. A demo that skips those is a demo that cannot show the board
 * working, and cannot catch it when it stops.
 */
export async function loadBoardTickets(locationId: string): Promise<BoardTicketRow[]> {
  const db = client();
  if (!db) return demoBoardAt(Date.now(), locationId);
  return fetchBoardTickets(db, locationId);
}
