import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  createDemoSyncClient, type DemoSyncBoardTicket, type DemoSyncClient,
} from '@platform/api-client';
import { abortRead, fetchBoardTickets, readWithRetry } from '@platform/data';
import { resolveBoardConfig, type BoardConfig } from '@platform/domain';
import type { BoardTicketRow } from '@platform/schema';
import { resolveCopy, type BrandCopy } from '@platform/ui/copy';

import { deviceToken, deviceTokenConfigured } from './device-token';

import { DEMO_BRAND_CONFIG, demoBoardAt, demoLocationName } from './demo-board';
import { displayTheme, type DisplayTheme } from './theme';

const demoSyncClient = createDemoSyncClient(process.env.DEMO_SYNC_URL, 'pos');

export function previewWallEnabled(flag: string | undefined, syncConfigured: boolean): boolean {
  return flag === '1' && syncConfigured;
}

const synchronizedPreview = previewWallEnabled(
  process.env.PREVIEW_WALL,
  demoSyncClient !== null,
);

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
  /**
   * True when this is a production deployment with no device token: the screen
   * is not paired to a location, so there is nothing honest to draw.
   */
  unpaired: boolean;
  demoSynced: boolean;
};

type BrandBits = { name: string; config: unknown };

async function loadBrandBits(db: SupabaseClient, locationId: string): Promise<BrandBits | null> {
  const location = await readWithRetry('display location', (signal) => abortRead(db
    .from('locations')
    .select('name, brand_id')
    .eq('id', locationId), signal)
    .maybeSingle<{ name: string; brand_id: string }>());
  if (!location) return null;

  // brand_storefront, not brands: the table also carries the platform's fee
  // terms, which stay claim-gated (0015). A wall screen has no business
  // holding a query that could ever return them.
  const brand = await readWithRetry('display brand', (signal) => abortRead(db
    .from('brand_storefront')
    .select('brand_config')
    .eq('id', location.brand_id), signal)
    .maybeSingle<{ brand_config: unknown }>());
  return { name: location.name, config: brand?.brand_config ?? {} };
}

function fixtures(
  locationId: string,
  degraded: boolean,
  tickets = demoBoardAt(Date.now(), locationId),
): BoardSnapshot {
  return {
    locationName: demoLocationName(locationId),
    tickets,
    config: resolveBoardConfig(DEMO_BRAND_CONFIG),
    copy: resolveCopy((DEMO_BRAND_CONFIG as { copy?: unknown }).copy),
    theme: displayTheme(DEMO_BRAND_CONFIG),
    live: false,
    degraded,
    unpaired: false,
    demoSynced: demoSyncClient !== null,
  };
}

/**
 * A production screen with no device token.
 *
 * Deliberately empty rather than fixtures: an unpaired board must not be
 * mistakable for a working one. It keeps the platform's default palette
 * because there is no brand to hydrate from -- not knowing which shop this is
 * is precisely the condition being reported.
 */
function unpaired(): BoardSnapshot {
  return {
    locationName: '',
    tickets: [],
    config: resolveBoardConfig(null),
    copy: resolveCopy(null),
    theme: displayTheme(null),
    live: false,
    degraded: false,
    unpaired: true,
    demoSynced: false,
  };
}

const ACTIVE_BOARD_STATUSES = new Set(['paid', 'in_progress', 'ready']);

function demoSyncTickets(tickets: DemoSyncBoardTicket[], locationId: string): BoardTicketRow[] {
  return tickets.filter((ticket) => ACTIVE_BOARD_STATUSES.has(ticket.status)).map((ticket) => ({
    id: ticket.id, brand_id: 'brand-demo', location_id: locationId,
    daily_number: ticket.dailyNumber, guest_label: ticket.guestName,
    status: ticket.status as BoardTicketRow['status'],
    fulfillment_type: ticket.fulfillmentType, channel: ticket.channel,
    arrived_at: null, loyalty_tier: null, updated_at: ticket.updatedAt,
  }));
}

/** Keep synchronized sales visible by using fixtures only for otherwise empty board rows. */
export function prioritizeSynchronizedTickets(
  fixtureTickets: readonly BoardTicketRow[],
  synchronizedTickets: readonly BoardTicketRow[],
  maxLines: number,
): BoardTicketRow[] {
  if (maxLines <= 0) return [...fixtureTickets, ...synchronizedTickets];
  // `maxLines` is an upper bound, not proof that every tenant row shape fits
  // the physical screen. The fixture roster is the viewport-tested baseline,
  // so replace one of those rows for every real demo sale instead of filling
  // nominal spare slots that may sit below the clipped list.
  const testedCapacity = Math.min(fixtureTickets.length, maxLines);
  const fixtureLimit = Math.max(0, testedCapacity - synchronizedTickets.length);
  return [...fixtureTickets.slice(0, fixtureLimit), ...synchronizedTickets];
}

/** Build a fixture board around broker orders; a configured broker failure stays a failure. */
export async function synchronizedFixtureTickets(
  locationId: string,
  syncClient: Pick<DemoSyncClient, 'board'> | null = demoSyncClient,
  now = Date.now(),
): Promise<BoardTicketRow[]> {
  const base = demoBoardAt(now, locationId);
  if (!syncClient) return base;
  const synchronized = demoSyncTickets(await syncClient.board(), locationId);
  return prioritizeSynchronizedTickets(
    base,
    synchronized,
    resolveBoardConfig(DEMO_BRAND_CONFIG).maxLines,
  );
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
    if (!demoAllowed()) return unpaired();
    try { return fixtures(locationId, false, await synchronizedFixtureTickets(locationId)); }
    catch { return fixtures(locationId, demoSyncClient !== null); }
  }

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
      unpaired: false,
      demoSynced: false,
    };
  } catch (error) {
    console.error('display: board read failed', error);
    // Degraded, not demo: a failed read on a paired screen must not start
    // inventing guests either.
    return { ...unpaired(), degraded: true, unpaired: false };
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
    return synchronizedFixtureTickets(locationId);
  }
  return fetchBoardTickets(db, locationId);
}
