import type { BoardTicketRow } from '@platform/schema';

/**
 * A board mid-shift, for reviewing the screen with no database.
 *
 * Shaped to exercise what the display has to handle rather than to look tidy:
 * a long name against a short one, both columns occupied, every channel the
 * enum carries, a curbside guest who has already tapped "I'm here", and a
 * ticket with no name at all.
 *
 * These are fixtures, not a tenant. The live path always reads `brand_config`
 * off the brand the location belongs to; the sample config below exists only
 * so the surface can be demoed, reviewed and screenshotted before any
 * infrastructure is stood up -- and it is the one file in this app allowed to
 * hold literal brand values for that reason.
 */

/**
 * The roster. Everything about a ticket except where it is in the queue.
 *
 * Status is not here because a board that never moves is not a demo of a
 * board -- it is a screenshot. `demoBoardAt` walks these through the queue on
 * a fixed cycle so the fixtures path exercises the same poll, reconcile and
 * linger the live path does, which is the only way any of that code is ever
 * actually run before a shop hangs the screen.
 */
type RosterEntry = Omit<BoardTicketRow, 'status'> & { cycleOffset: number };

const DEMO_ROSTER: readonly RosterEntry[] = [
  {
    cycleOffset: 0,
    id: 'tkt-38', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 38, guest_label: 'Marguerite Vandersteen',
    fulfillment_type: 'delivery', channel: 'app', arrived_at: null,
    loyalty_tier: 'coffee-legend', updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    cycleOffset: 1,
    id: 'tkt-39', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 39, guest_label: 'Harper E.',
    fulfillment_type: 'pickup', channel: 'app', arrived_at: null,
    loyalty_tier: 'house-regular', updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    cycleOffset: 2,
    id: 'tkt-40', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 40, guest_label: 'Quinn N.',
    fulfillment_type: 'curbside', channel: 'app',
    arrived_at: '2026-08-23T15:03:10.000Z',
    loyalty_tier: 'daily-ritual', updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    cycleOffset: 3,
    id: 'tkt-41', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 41, guest_label: 'Devin P.',
    fulfillment_type: 'pickup', channel: 'kiosk', arrived_at: null,
    loyalty_tier: null, updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    cycleOffset: 4,
    id: 'tkt-42', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 42, guest_label: 'Alex Rivera',
    fulfillment_type: 'pickup', channel: 'pos', arrived_at: null,
    loyalty_tier: 'daily-ritual', updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    // No name at all: a till operator in a rush skips it, and the board has
    // to look deliberate rather than broken when that happens.
    cycleOffset: 5,
    id: 'tkt-43', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 43, guest_label: '',
    fulfillment_type: 'pickup', channel: 'pos', arrived_at: null,
    loyalty_tier: null, updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    cycleOffset: 6,
    id: 'tkt-44', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 44, guest_label: 'Priya N.',
    fulfillment_type: 'pickup', channel: 'web', arrived_at: null,
    loyalty_tier: 'first-sip', updated_at: '2026-08-23T15:04:00.000Z',
  },
  {
    cycleOffset: 7,
    id: 'tkt-45', brand_id: 'brand-demo', location_id: 'demo',
    daily_number: 45, guest_label: 'Tobias W.',
    fulfillment_type: 'pickup', channel: 'kiosk', arrived_at: null,
    loyalty_tier: 'house-regular', updated_at: '2026-08-23T15:04:00.000Z',
  },
];

/** One step of the demo queue. Slow enough to read, quick enough to watch. */
export const DEMO_STEP_MS = 9_000;
const CYCLE = DEMO_ROSTER.length;

/**
 * Where a ticket is `offset` steps into the cycle.
 *
 * Two steps waiting, three being made, two ready, one gone -- roughly the
 * shape of a real espresso queue, and chosen so both columns are always
 * occupied. `null` means the read simply does not return it, which is exactly
 * what `board_tickets` does to a collected order and therefore what the
 * client's linger has to handle.
 */
function stageFor(step: number): BoardTicketRow['status'] | null {
  switch (((step % CYCLE) + CYCLE) % CYCLE) {
    case 0: case 1: return 'paid';
    case 2: case 3: case 4: return 'in_progress';
    case 5: case 6: return 'ready';
    default: return null;
  }
}

/**
 * The board as it stands at `now`.
 *
 * A pure function of the clock, so a test can ask for any point in the cycle
 * and two screens pointed at the same demo agree with each other.
 */
export function demoBoardAt(now: number, locationId = 'demo'): BoardTicketRow[] {
  const step = Math.floor(now / DEMO_STEP_MS);
  return DEMO_ROSTER.flatMap(({ cycleOffset, ...ticket }) => {
    const status = stageFor(step - cycleOffset);
    return status === null ? [] : [{ ...ticket, status, location_id: locationId }];
  }).sort((a, b) => (a.daily_number ?? 0) - (b.daily_number ?? 0));
}

/** The roster itself, for tests that check what the fixtures are made of. */
export const DEMO_TICKETS: readonly Omit<BoardTicketRow, 'status'>[] =
  DEMO_ROSTER.map(({ cycleOffset: _cycleOffset, ...ticket }) => ticket);

/**
 * A sample brand, in the exact shape `brands.brand_config` holds.
 *
 * Same keys, same nesting, same types -- so the fixtures path exercises
 * `resolveTokens`, `resolveCopy` and `resolveBoardConfig` rather than routing
 * around them. A demo that skips the resolvers is a demo that cannot catch a
 * bug in them.
 */
export const DEMO_BRAND_CONFIG = {
  tokens: {
    primary: '#2E211A',
    secondary: '#4C3626',
    surface: '#FAF5EF',
    surfaceElevated: '#FFFFFF',
    accent: '#B08D57',
    textPrimary: '#241710',
    textMuted: '#6B5B4E',
    success: '#3E6B4F',
    warning: '#9A5B24',
    danger: '#A04038',
    radius: { sm: 10, md: 16, lg: 24, pill: 999 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
    fontDisplay: 'Fraunces',
    fontBody: 'Inter',
    motion: { fast: 120, base: 220, slow: 360 },
  },
  copy: {
    appName: 'Coffee Story',
    pointsName: 'Beans',
  },
  board: {
    showGuestStatus: true,
    showChannel: true,
    maxLines: 9,
    appUrl: 'https://coffeestoryco.com',
    tiers: [
      { slug: 'first-sip', label: 'First Sip', minLifetimePoints: 0, tone: 'muted', color: '#8C7A6B', icon: '◇' },
      { slug: 'daily-ritual', label: 'Daily Ritual', minLifetimePoints: 500, tone: 'accent', color: '#B08D57', icon: '◆' },
      { slug: 'house-regular', label: 'House Regular', minLifetimePoints: 1500, tone: 'success', color: '#3E6B4F', icon: '✦' },
      { slug: 'coffee-legend', label: 'Coffee Legend', minLifetimePoints: 2500, tone: 'primary', color: '#2E211A', icon: '★' },
    ],
  },
} as const;

const DEMO_NAMES: Readonly<Record<string, string>> = {
  'loc-downtown': 'Downtown',
  'loc-uptown': 'Uptown',
};

export function demoLocationName(locationId: string): string {
  return DEMO_NAMES[locationId] ?? 'Downtown';
}
