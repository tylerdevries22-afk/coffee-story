import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlaceOrderRequest } from '@platform/api-client';
import {
  createDemoSyncStore, demoSyncBoardTickets, demoSyncStore, DemoSyncError, isDemoSyncError,
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
