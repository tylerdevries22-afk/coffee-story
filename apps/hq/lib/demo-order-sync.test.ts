import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlaceOrderRequest } from '@platform/api-client';
import {
  createDemoSyncStore, DEMO_OPENING_ROSTER, demoSyncBoardTickets, demoSyncStore,
  DemoSyncError, isDemoSyncError, seedDemoRoster,
} from './demo-order-sync';

const ORDER: PlaceOrderRequest = {
  locationId: 'demo', fulfillmentType: 'pickup', tenderType: 'square_card',
  lines: [{
    itemSlug: 'tiramisu-latte', sizeSlug: '12-oz', quantity: 1,
    note: 'Extra hot', packContents: [{ itemSlug: 'ube-cookie', quantity: 2 }],
  }],
  tipCents: 50, maximumTotalCents: 650, guestLabel: 'Demo Guest',
};

describe('demo order sync store', () => {
  it('recognizes safe errors across separately compiled route chunks', () => {
    const local = new DemoSyncError('not_found', 'Missing.');
    const reconstructed = { name: local.name, code: local.code, message: local.message };
    assert.equal(isDemoSyncError(local), true);
    assert.equal(isDemoSyncError(reconstructed), true);
    assert.equal(isDemoSyncError({ name: 'DemoSyncError', code: 'unknown', message: 'No.' }), false);
  });

  it('shares the route store through the process global', () => {
    const root = globalThis as typeof globalThis & { __coffeeStoryDemoSyncStore?: unknown };
    assert.equal(root.__coffeeStoryDemoSyncStore, demoSyncStore);
  });

  it('places idempotently and projects a board-ready order', () => {
    const store = createDemoSyncStore(
      () => new Date('2026-08-24T12:00:00.000Z'),
      'session-a',
    );
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    const first = store.place(ORDER, requestId, 'kiosk');
    const replay = store.place(ORDER, requestId, 'kiosk');
    assert.equal(first.replayed, false); assert.equal(replay.replayed, true);
    assert.equal(first.response.dailyNumber, 46);
    assert.equal(first.response.status, 'created');
    assert.equal(store.snapshot().sessionId, 'session-a');
    assert.equal(store.snapshot().orders[0]?.sessionId, 'session-a');
    assert.equal(store.snapshot().orders[0]?.shortCode, '46');
    assert.deepEqual(store.snapshot().orders[0]?.lines, [{
      name: 'Tiramisu Latte', quantity: 1, options: ['12 Oz'], note: 'Extra hot',
      packContents: [{ itemSlug: 'ube-cookie', name: 'Ube Cookie', quantity: 2 }],
    }]);
    assert.equal(store.snapshot().orders[0]?.guestName, 'Demo Guest');
    assert.equal(store.snapshot().revision, 1);
  });

  it('rejects key reuse with changed content and illegal status jumps', () => {
    const store = createDemoSyncStore();
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    store.place(ORDER, requestId, 'kiosk');
    assert.throws(() => store.place({ ...ORDER, maximumTotalCents: 700 }, requestId, 'kiosk'),
      (error) => error instanceof DemoSyncError && error.code === 'idempotency_conflict');
    assert.throws(() => store.transition(requestId, 'picked_up', 'pos'),
      (error) => error instanceof DemoSyncError && error.code === 'transition_invalid');
  });

  it('rejects malformed boundary values instead of throwing an internal error', () => {
    const store = createDemoSyncStore();
    assert.throws(() => store.place(null, 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96', 'kiosk'),
      (error) => error instanceof DemoSyncError && error.code === 'invalid_request');
    assert.throws(() => store.place({ ...ORDER, lines: [{ itemSlug: '../secret', quantity: 1 }] },
      '6a39012e-1372-4406-a7c6-5c94e61268dd', 'kiosk'),
    (error) => error instanceof DemoSyncError && error.code === 'invalid_request');
  });

  it('moves through the production state machine and increments revisions', () => {
    const store = createDemoSyncStore();
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    store.place(ORDER, requestId, 'app');
    store.transition(requestId, 'paid', 'app'); store.transition(requestId, 'in_progress', 'pos');
    store.transition(requestId, 'ready', 'pos'); store.transition(requestId, 'picked_up', 'pos');
    assert.equal(store.snapshot().orders[0]?.status, 'picked_up');
    assert.equal(store.place(ORDER, requestId, 'app').response.status, 'picked_up');
    assert.equal(store.snapshot().revision, 5);
  });

  it('replays the original transition response after another surface advances the order', () => {
    const store = createDemoSyncStore(() => new Date('2026-08-24T12:00:00.000Z'));
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    const transitionId = '780708c5-e4a6-46e7-82db-83bcda6b7d60';
    store.place(ORDER, requestId, 'app');
    const paid = store.transition(requestId, 'paid', 'app', transitionId);
    store.transition(requestId, 'in_progress', 'pos');
    const replay = store.transition(requestId, 'paid', 'app', transitionId);
    assert.equal(paid.status, 'paid');
    assert.equal(replay.status, 'paid');
    assert.equal(store.snapshot().orders[0]?.status, 'in_progress');
  });

  it('refuses transition-key reuse with a different target', () => {
    const store = createDemoSyncStore();
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    const transitionId = '780708c5-e4a6-46e7-82db-83bcda6b7d60';
    store.place(ORDER, requestId, 'app');
    store.transition(requestId, 'paid', 'app', transitionId);
    assert.throws(
      () => store.transition(requestId, 'in_progress', 'pos', transitionId),
      (error) => error instanceof DemoSyncError && error.code === 'idempotency_conflict',
    );
  });

  it('projects only active, display-safe ticket fields', () => {
    const store = createDemoSyncStore(() => new Date('2026-08-24T12:00:00.000Z'));
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    store.place(ORDER, requestId, 'kiosk');
    assert.deepEqual(demoSyncBoardTickets(store.snapshot()), []);
    store.transition(requestId, 'paid', 'pos');
    assert.deepEqual(demoSyncBoardTickets(store.snapshot()), [{
      id: requestId,
      dailyNumber: 46,
      guestName: 'Demo Guest',
      status: 'paid',
      fulfillmentType: 'pickup',
      channel: 'kiosk',
      updatedAt: '2026-08-24T12:00:00.000Z',
    }]);
  });

  it('rejects a guest cancellation after payment even if polling is stale', () => {
    const store = createDemoSyncStore();
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    store.place(ORDER, requestId, 'app');
    store.transition(requestId, 'paid', 'app');
    assert.throws(() => store.transition(requestId, 'cancelled', 'app'),
      (error) => error instanceof DemoSyncError && error.code === 'transition_invalid');
  });

  it('replays the same accepted guest label after whitespace normalization', () => {
    const store = createDemoSyncStore(() => new Date('2026-08-24T12:00:00.000Z'), 'session-a');
    const requestId = 'dd143f9e-dbef-4dc4-b26d-66eaf4618e96';
    const first = store.place({ ...ORDER, guestLabel: 'Ada Lovelace' }, requestId, 'app');
    const replay = store.place({ ...ORDER, guestLabel: '  Ada   Lovelace  ' }, requestId, 'app');
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.response, first.response);
  });
});

/*
 * The roster is the fix for "pressing Ready does nothing".
 *
 * Every surface on the demo plane reads this one list, so what it is allowed
 * to contain is a contract rather than sample data: it has to survive the real
 * state machine, and it has to project onto the wall.
 */
describe('the shared opening roster', () => {
  it('reaches every declared status through the real state machine', () => {
    const store = seedDemoRoster(createDemoSyncStore(
      () => new Date('2026-08-24T12:00:00.000Z'),
      'session-open',
    ));
    const byId = new Map(store.snapshot().orders.map((order) => [order.id, order] as const));

    assert.equal(byId.size, DEMO_OPENING_ROSTER.length);
    for (const entry of DEMO_OPENING_ROSTER) {
      assert.equal(byId.get(entry.id)?.status, entry.status, entry.id);
    }
  });

  it('opens the board with people waiting and people served', () => {
    const store = seedDemoRoster(createDemoSyncStore(
      () => new Date('2026-08-24T12:00:00.000Z'),
      'session-open',
    ));
    const tickets = demoSyncBoardTickets(store.snapshot());

    assert.equal(tickets.length, DEMO_OPENING_ROSTER.length,
      'every opening order is a board-visible status');
    for (const status of ['paid', 'in_progress', 'ready'] as const) {
      assert.ok(tickets.some((ticket) => ticket.status === status),
        `the opening board must exercise ${status}`);
    }
    // The wall has to stay legible for a guest who gave no name and for the
    // longest one it accepts; both are in the roster rather than in a fixture
    // only one of the three surfaces ever loads.
    assert.ok(tickets.some((ticket) => ticket.guestName === ''));
    assert.ok(tickets.some((ticket) => ticket.guestName.length > 18));
  });

  it('is replayable, so a hot reload does not double the shop', () => {
    const store = seedDemoRoster(createDemoSyncStore());
    seedDemoRoster(store);
    assert.equal(store.snapshot().orders.length, DEMO_OPENING_ROSTER.length);
  });

  it('leaves room for the orders the preview places on top of it', () => {
    const store = seedDemoRoster(createDemoSyncStore());
    const placed = store.place(ORDER, 'e0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b', 'kiosk');
    const rosterHigh = Math.max(...store.snapshot().orders
      .filter((order) => order.id !== placed.response.orderId)
      .map((order) => order.dailyNumber));
    assert.ok(
      (placed.response.dailyNumber ?? 0) > rosterHigh,
      'a new sale must number past the roster, not collide with it',
    );
  });
});
