import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LEAVING_SOON_MINUTES, leavingSoon, minutesRemaining, shiftState, sortRoster, type Shift,
} from './shift';

const NOW = new Date('2026-08-23T16:00:00Z');

const shift = (id: string, startsAt: string, endsAt: string): Shift => ({
  id, staffName: id, role: 'barista', startsAt, endsAt,
});

const morning = shift('morning', '2026-08-23T13:00:00Z', '2026-08-23T17:00:00Z');
const mid = shift('mid', '2026-08-23T15:00:00Z', '2026-08-23T22:00:00Z');
const evening = shift('evening', '2026-08-23T21:00:00Z', '2026-08-24T04:00:00Z');
const done = shift('done', '2026-08-23T06:00:00Z', '2026-08-23T13:00:00Z');

describe('shiftState', () => {
  it('reads the window against the clock', () => {
    assert.equal(shiftState(morning, NOW), 'on');
    assert.equal(shiftState(evening, NOW), 'upcoming');
    assert.equal(shiftState(done, NOW), 'ended');
  });

  it('is on at the exact start and ended at the exact end', () => {
    assert.equal(shiftState(mid, new Date('2026-08-23T15:00:00Z')), 'on');
    assert.equal(shiftState(mid, new Date('2026-08-23T22:00:00Z')), 'ended');
  });

  it('treats a malformed window as ended rather than as live', () => {
    // Failing closed: a broken row must not put a phantom name on the floor.
    assert.equal(shiftState(shift('bad', 'nonsense', 'worse'), NOW), 'ended');
  });
});

describe('sortRoster', () => {
  it('puts who is here now first, then who is next, then who has gone', () => {
    const roster = sortRoster([evening, done, morning, mid], NOW);
    assert.deepEqual(roster.map((s) => s.id), ['morning', 'mid', 'evening', 'done']);
  });

  it('orders within a group by start, because a roster is a timeline', () => {
    const roster = sortRoster([mid, morning], NOW);
    assert.deepEqual(roster.map((s) => s.id), ['morning', 'mid']);
  });

  it('does not mutate what it was given', () => {
    const input = [evening, morning];
    sortRoster(input, NOW);
    assert.deepEqual(input.map((s) => s.id), ['evening', 'morning']);
  });
});

describe('minutesRemaining', () => {
  it('counts whole minutes to the end of a shift', () => {
    assert.equal(minutesRemaining(morning, NOW), 60);
  });

  it('is zero once the shift has ended, never negative', () => {
    assert.equal(minutesRemaining(done, NOW), 0);
  });
});

describe('leavingSoon', () => {
  it('names only people on now and inside the window', () => {
    const soon = leavingSoon([morning, mid, evening, done], new Date('2026-08-23T16:45:00Z'));
    assert.deepEqual(soon.map((s) => s.id), ['morning']);
  });

  it('drops someone the moment they have actually gone', () => {
    // Otherwise the floor reads as thinner than it is for the rest of the day.
    const soon = leavingSoon([morning], new Date('2026-08-23T17:30:00Z'));
    assert.deepEqual(soon, []);
  });

  it('says nothing when the whole floor is staying', () => {
    assert.deepEqual(leavingSoon([mid, evening], NOW), []);
    assert.equal(LEAVING_SOON_MINUTES, 30);
  });
});
