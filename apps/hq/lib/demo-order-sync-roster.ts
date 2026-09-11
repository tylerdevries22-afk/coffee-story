import type { PlaceOrderRequest } from '@platform/api-client';
import { transitionPath, type OrderChannel, type OrderStatus } from '@platform/schema';

import { createDemoSyncStore, type DemoSyncStore } from './demo-order-sync-store';

/**
 * The shop at open, as one roster every surface shares.
 *
 * Before this existed, each surface invented its own: the operator seeded five
 * local orders, the wall cycled eight of its own, and the broker started empty
 * at 46. Three rosters that could never agree, which is why pressing Ready on
 * the operator changed nothing on the wall -- the ticket it moved was not a
 * ticket the wall had. The demo plane now has one roster, and it lives here,
 * because the broker is the only thing all three surfaces already talk to.
 *
 * `minutesAgo` backdates each order so the queue opens looking like a morning
 * that has been running for a while rather than eight orders placed in the
 * same instant, and so the two ready tickets sort by how long they have been
 * waiting at the counter.
 */
export type DemoRosterEntry = {
  id: string;
  guestLabel?: string;
  status: OrderStatus;
  minutesAgo: number;
  /** Where the order came from, so the board's provenance line has range. */
  channel: OrderChannel;
  order: PlaceOrderRequest;
};

function rosterOrder(
  itemSlug: string,
  sizeSlug: string | null,
  totalCents: number,
  guestLabel?: string,
): PlaceOrderRequest {
  return {
    locationId: 'demo',
    fulfillmentType: 'pickup',
    tenderType: 'square_card',
    lines: [{ itemSlug, quantity: 1, ...(sizeSlug ? { sizeSlug } : {}) }],
    tipCents: 0,
    maximumTotalCents: totalCents,
    ...(guestLabel ? { guestLabel } : {}),
  };
}

export const DEMO_OPENING_ROSTER: readonly DemoRosterEntry[] = [
  {
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000001',
    status: 'ready',
    channel: 'kiosk',
    minutesAgo: 11,
    // The longest name the board is asked to hold, so a wall that clips is
    // caught by looking at it rather than by a guest whose name is cut short.
    order: rosterOrder('honey-lavender-latte', '16-oz', 725, 'Marguerite Vandersteen'),
  },
  {
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000002',
    status: 'ready',
    channel: 'app',
    minutesAgo: 8,
    order: rosterOrder('cold-brew', '20-oz', 600, 'Harper E.'),
  },
  {
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000003',
    status: 'in_progress',
    channel: 'pos',
    minutesAgo: 6,
    order: rosterOrder('tiramisu-latte', '12-oz', 650, 'Quinn N.'),
  },
  {
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000004',
    status: 'in_progress',
    channel: 'web',
    minutesAgo: 5,
    order: rosterOrder('matcha-latte', '16-oz', 700, 'Devin P.'),
  },
  {
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000005',
    status: 'paid',
    channel: 'app',
    minutesAgo: 4,
    order: rosterOrder('spanish-latte', '12-oz', 625, 'Alex Rivera'),
  },
  {
    // Nameless on purpose: a guest may decline to give one, and the board has
    // to stay legible with an empty name rather than inventing "Guest".
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000006',
    status: 'paid',
    channel: 'kiosk',
    minutesAgo: 3,
    order: rosterOrder('mochi-donut', null, 400),
  },
  {
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000007',
    status: 'paid',
    channel: 'web',
    minutesAgo: 2,
    order: rosterOrder('boba-brown-sugar', '16-oz', 750, 'Priya N.'),
  },
  {
    id: '2b1f1c64-1b3c-4a4a-9a1a-000000000008',
    status: 'paid',
    channel: 'app',
    minutesAgo: 1,
    order: rosterOrder('avocado-toast', null, 900, 'Tobias W.'),
  },
];

/**
 * Walk each roster entry to its opening status through the real state machine.
 *
 * Deliberately not a set of pre-built order objects assigned straight into the
 * map: seeding through `place` and `transition` means the opening board is
 * subject to every rule a live order is, so a roster that could not exist is a
 * failure here rather than a shape the surfaces have to tolerate later.
 */
export function seedDemoRoster(
  store: DemoSyncStore,
  roster: readonly DemoRosterEntry[] = DEMO_OPENING_ROSTER,
): DemoSyncStore {
  for (const entry of roster) {
    store.place(entry.order, entry.id, entry.channel);
    for (const step of transitionPath('created', entry.status) ?? []) {
      store.transition(entry.id, step, 'pos', `${entry.id}:${step}`);
    }
  }
  return store;
}

type DemoSyncGlobal = typeof globalThis & {
  __coffeeStoryDemoSyncStore?: DemoSyncStore;
};

// Next compiles route handlers into separate chunks. A module singleton is
// therefore one store per route, while globalThis is one store per local HQ
// process and survives development hot reloads.
const demoSyncGlobal = globalThis as DemoSyncGlobal;

/**
 * The clock the shared store reads, wound back while the roster is seeded.
 *
 * The factory takes its clock as a parameter precisely so it can be steered;
 * this steers it for the length of one seeding pass and then hands the store
 * the real time it runs on for the rest of the process.
 */
function seededDemoSyncStore(): DemoSyncStore {
  let backdateMs = 0;
  const store = createDemoSyncStore(() => new Date(Date.now() - backdateMs));
  for (const entry of DEMO_OPENING_ROSTER) {
    backdateMs = entry.minutesAgo * 60_000;
    seedDemoRoster(store, [entry]);
  }
  backdateMs = 0;
  return store;
}

export const demoSyncStore = demoSyncGlobal.__coffeeStoryDemoSyncStore ?? seededDemoSyncStore();
demoSyncGlobal.__coffeeStoryDemoSyncStore = demoSyncStore;
