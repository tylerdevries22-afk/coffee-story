import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyDemoBlockTime } from './dashboard';
import { DEMO_STAFF } from '@/data/demo';

describe('applyDemoBlockTime', () => {
  it('adds a visible blocked slot and shrinks open minutes', () => {
    const next = applyDemoBlockTime(DEMO_STAFF, {
      kind: 'block-time',
      startsAt: '2026-08-03T16:00:00.000Z',
      endsAt: '2026-08-03T17:30:00.000Z',
      reason: 'Deep clean',
    }, 'demo-block-test');

    const added = next.appointments[next.appointments.length - 1];
    assert.equal(added.id, 'demo-block-test');
    assert.equal(added.serviceName, 'Blocked · Deep clean');
    assert.equal(added.subtotalCents, 0);
    assert.equal(next.openMinutes, DEMO_STAFF.openMinutes - 90);
    assert.equal(next.appointments.length, DEMO_STAFF.appointments.length + 1);
  });

  it('never drives open minutes below zero', () => {
    const tight = { ...DEMO_STAFF, openMinutes: 15 };
    const next = applyDemoBlockTime(tight, {
      kind: 'block-time',
      startsAt: '2026-08-03T16:00:00.000Z',
      endsAt: '2026-08-03T18:00:00.000Z',
      reason: 'Errand',
    }, 'demo-block-test-2');
    assert.equal(next.openMinutes, 0);
  });
});
