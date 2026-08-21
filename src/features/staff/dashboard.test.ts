import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyDemoBlockTime, applyDemoSoapNote, soapNotesForClient } from './dashboard';
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

describe('applyDemoSoapNote', () => {
  it('prepends the note so care records show the newest first', () => {
    const next = applyDemoSoapNote(DEMO_STAFF, {
      kind: 'soap',
      customerId: 'client-1',
      clientName: 'Alex Rivera',
      serviceName: 'Deep Tissue Massage',
      treatmentDate: '2026-07-31',
      subjective: 's', objective: 'o', assessment: 'a', plan: 'p',
    }, 'demo-soap-test', '2026-07-31T18:00:00.000Z');

    const notes = soapNotesForClient(next, 'client-1');
    assert.equal(notes[0]?.id, 'demo-soap-test');
    assert.equal(notes.length, soapNotesForClient(DEMO_STAFF, 'client-1').length + 1);
    assert.equal(soapNotesForClient(next, 'client-2').length, soapNotesForClient(DEMO_STAFF, 'client-2').length);
  });
});
