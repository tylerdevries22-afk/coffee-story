import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dropArchive, dropStatus, dropWindowLabel, featuredDrop, weeklyDrops, type Drop } from './drops';

const drop = (id: string, startsAt: string, endsAt: string): Drop => ({
  id, itemId: `item-${id}`, title: id, blurb: '', startsAt, endsAt,
});

/**
 * Windows open and close at 8am in the shop's zone (America/Denver, UTC-6 in
 * August), not at midnight UTC.
 *
 * The fixtures used to say T00:00:00Z and expect the UTC calendar day, which
 * is the previous evening in Denver -- so dropWindowLabel's assertions only
 * held on a machine running UTC. A drop window is a shop-local fact; writing
 * it as one is what makes the expectations true anywhere.
 */
const NOW = new Date('2026-08-22T12:00:00Z');
const past = drop('past', '2026-08-01T14:00:00Z', '2026-08-04T14:00:00Z');
const live = drop('live', '2026-08-20T14:00:00Z', '2026-08-24T14:00:00Z');
const soon = drop('soon', '2026-08-25T14:00:00Z', '2026-08-28T14:00:00Z');

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

describe('weeklyDrops', () => {
  it('lists live drops before upcoming and drops the ended', () => {
    assert.deepEqual(weeklyDrops([past, soon, live], NOW).map((entry) => entry.id), ['live', 'soon']);
  });

  it('is empty when nothing is live or coming', () => {
    assert.deepEqual(weeklyDrops([past], NOW), []);
  });
});

describe('dropWindowLabel', () => {
  it('spans earliest start to latest end within a month', () => {
    assert.equal(dropWindowLabel([live, soon]), 'Aug 20 – 28');
  });

  it('names both months when the window crosses one', () => {
    const straddle = drop('straddle', '2026-08-30T14:00:00Z', '2026-09-05T14:00:00Z');
    assert.equal(dropWindowLabel([straddle]), 'Aug 30 – Sep 5');
  });

  it('returns empty for malformed windows instead of NaN dates', () => {
    assert.equal(dropWindowLabel([drop('bad', 'nonsense', 'worse')]), '');
  });
});

describe('dropArchive', () => {
  it('lists live and past drops newest first, never upcoming', () => {
    assert.deepEqual(dropArchive([past, soon, live], NOW).map((d) => d.id), ['live', 'past']);
  });
});
