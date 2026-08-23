import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyDemoBlockTime, applyDemoGuestNote, notesForGuest } from './dashboard';
import { DEMO_STAFF } from '@/data/demo';

describe('applyDemoBlockTime', () => {
  it('adds a visible blocked slot and shrinks open minutes', () => {
    const next = applyDemoBlockTime(DEMO_STAFF, {
      kind: 'block-time',
      startsAt: '2026-08-03T16:00:00.000Z',
      endsAt: '2026-08-03T17:30:00.000Z',
      reason: 'Deep clean',
    }, 'demo-block-test');

    const added = next.orders[next.orders.length - 1];
    assert.equal(added.id, 'demo-block-test');
    assert.equal(added.summary, 'Blocked · Deep clean');
    assert.equal(added.subtotalCents, 0);
    assert.equal(next.openMinutes, DEMO_STAFF.openMinutes - 90);
    assert.equal(next.orders.length, DEMO_STAFF.orders.length + 1);
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

describe('applyDemoGuestNote', () => {
  it('prepends the note so care records show the newest first', () => {
    const next = applyDemoGuestNote(DEMO_STAFF, {
      kind: 'guest-note',
      note: 'Usual: pistachio latte, oat, half-sweet.',
      customerId: 'client-1',
      guestName: 'Alex Rivera',
    }, 'demo-soap-test', '2026-07-31T18:00:00.000Z');

    const notes = notesForGuest(next, 'client-1');
    assert.equal(notes[0]?.id, 'demo-soap-test');
    assert.equal(notes.length, notesForGuest(DEMO_STAFF, 'client-1').length + 1);
    assert.equal(notesForGuest(next, 'client-2').length, notesForGuest(DEMO_STAFF, 'client-2').length);
  });
});
