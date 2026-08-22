import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dropArchive, dropStatus, featuredDrop, type Drop } from './drops';

const drop = (id: string, startsAt: string, endsAt: string): Drop => ({
  id, itemId: `item-${id}`, title: id, blurb: '', startsAt, endsAt,
});

const NOW = new Date('2026-08-22T12:00:00Z');
const past = drop('past', '2026-08-01T00:00:00Z', '2026-08-04T00:00:00Z');
const live = drop('live', '2026-08-20T00:00:00Z', '2026-08-24T00:00:00Z');
const soon = drop('soon', '2026-08-25T00:00:00Z', '2026-08-28T00:00:00Z');

describe('dropStatus', () => {
  it('reads the window against the clock', () => {
    assert.equal(dropStatus(past, NOW), 'ended');
    assert.equal(dropStatus(live, NOW), 'live');
    assert.equal(dropStatus(soon, NOW), 'upcoming');
  });

  it('treats a malformed window as ended rather than featuring it', () => {
    assert.equal(dropStatus(drop('bad', 'nonsense', 'also-nonsense'), NOW), 'ended');
  });
});

describe('featuredDrop', () => {
  it('prefers the live drop', () => {
    assert.equal(featuredDrop([past, soon, live], NOW)?.id, 'live');
  });

  it('falls back to the next upcoming drop', () => {
    assert.equal(featuredDrop([past, soon], NOW)?.id, 'soon');
  });

  it('returns null when the calendar is empty', () => {
    assert.equal(featuredDrop([past], NOW), null);
  });

  it('picks the drop ending soonest when two are live', () => {
    const longer = drop('longer', '2026-08-19T00:00:00Z', '2026-08-30T00:00:00Z');
    assert.equal(featuredDrop([longer, live], NOW)?.id, 'live');
  });
});

describe('dropArchive', () => {
  it('lists live and past drops newest first, never upcoming', () => {
    assert.deepEqual(dropArchive([past, soon, live], NOW).map((d) => d.id), ['live', 'past']);
  });
});
