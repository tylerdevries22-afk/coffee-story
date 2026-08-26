import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isGuestCancellableDemoOrder, isUpcomingDemoOrder } from './order-history';

const NOW = Date.parse('2026-08-25T12:00:00.000Z');

describe('demo order history classification', () => {
  it('uses time for standalone fixtures and status for synchronized orders', () => {
    assert.equal(isUpcomingDemoOrder({
      status: 'paid', placedAt: '2026-08-25T11:00:00.000Z',
      scheduledFor: '2026-08-25T13:00:00.000Z',
    }, NOW), true);
    assert.equal(isUpcomingDemoOrder({
      status: 'paid', placedAt: '2026-08-25T10:00:00.000Z',
      scheduledFor: '2026-08-25T11:00:00.000Z',
    }, NOW), false);
    assert.equal(isUpcomingDemoOrder({
      status: 'ready', placedAt: '2026-08-25T10:00:00.000Z',
      scheduledFor: null, demoSynced: true,
    }, NOW), true);
    assert.equal(isUpcomingDemoOrder({
      status: 'picked_up', placedAt: '2026-08-25T13:00:00.000Z',
      scheduledFor: null, demoSynced: true,
    }, NOW), false);
  });

  it('allows guests to cancel only before payment is collected', () => {
    assert.equal(isGuestCancellableDemoOrder({ status: 'created' }), true);
    assert.equal(isGuestCancellableDemoOrder({ status: 'paid' }), false);
    assert.equal(isGuestCancellableDemoOrder({ status: 'in_progress' }), false);
    assert.equal(isGuestCancellableDemoOrder({ status: 'ready' }), false);
  });
});
