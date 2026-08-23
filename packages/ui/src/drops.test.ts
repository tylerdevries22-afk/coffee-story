import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dropArchive, dropStatus, dropWindowLabel, featuredDrop, weeklyDrops, type Drop } from './drops';

const drop = (id: string, startsAt: string, endsAt: string): Drop => ({
  id, itemId: `item-${id}`, title: id, blurb: '', startsAt, endsAt,
});

/** The zone the fixtures below are written in: the shop's own. */
const SHOP = 'America/Denver';

/**
 * Fixture windows are the shop's wall clock, not UTC midnight: a drop opens
 * when the shop opens (8am, 14:00Z in August) and closes when it closes
 * (8pm, 02:00Z the next day). Instants at UTC midnight used to stand in for
 * "the 20th" here, which is really 6pm on the 19th in Denver -- the fixtures
 * agreed with the label only because both were read through the same wrong
 * clock, so the suite passed in CI and the app still printed the wrong day.
 */
const NOW = new Date('2026-08-22T12:00:00Z');                            // 6am Aug 22, Denver
const past = drop('past', '2026-08-01T14:00:00Z', '2026-08-05T02:00:00Z'); // Aug 1 – 4
const live = drop('live', '2026-08-20T14:00:00Z', '2026-08-25T02:00:00Z'); // Aug 20 – 24
const soon = drop('soon', '2026-08-25T14:00:00Z', '2026-08-29T02:00:00Z'); // Aug 25 – 28

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
    const longer = drop('longer', '2026-08-19T14:00:00Z', '2026-08-31T02:00:00Z');
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

/** Run `body` with the device clock set to `timeZone`, then put it back. */
function withDeviceZone<T>(timeZone: string, body: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return body();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

describe('dropWindowLabel', () => {
  it('spans earliest start to latest end within a month', () => {
    assert.equal(dropWindowLabel([live, soon], SHOP), 'Aug 20 – 28');
  });

  it('names both months when the window crosses one', () => {
    const straddle = drop('straddle', '2026-08-30T14:00:00Z', '2026-09-06T02:00:00Z');
    assert.equal(dropWindowLabel([straddle], SHOP), 'Aug 30 – Sep 5');
  });

  it('returns empty for malformed windows instead of NaN dates', () => {
    assert.equal(dropWindowLabel([drop('bad', 'nonsense', 'worse')], SHOP), '');
  });

  /**
   * The bug this module was promoted to fix: the board is a fact about a
   * physical shop, so the phone reading it never gets a vote. A guest in
   * Denver, a guest in Tokyo and a CI box on UTC must all see the day the
   * shop is actually pouring.
   */
  it('renders the shop day whatever the device clock says', () => {
    for (const device of ['UTC', 'America/Denver', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      assert.equal(
        withDeviceZone(device, () => dropWindowLabel([live, soon], SHOP)),
        'Aug 20 – 28',
        `device zone ${device} moved the shop's drop window`,
      );
    }
  });

  it('reads the window in the location zone, not UTC', () => {
    // 8am in Denver is still Aug 20 in UTC, so a window that spans a UTC day
    // boundary is what tells the two zones apart: 1am Aug 21 UTC is 7pm on
    // the 20th in Denver, and the shop is still pouring the 20th's drop.
    const lateNight = drop('late', '2026-08-20T14:00:00Z', '2026-08-21T01:00:00Z');
    assert.equal(dropWindowLabel([lateNight], SHOP), 'Aug 20 – 20');
    assert.equal(dropWindowLabel([lateNight], 'UTC'), 'Aug 20 – 21');
  });

  it('falls back to UTC when the location carries an unusable zone', () => {
    // `locations.timezone` has no check constraint, so a typo must degrade
    // rather than throw under the hero.
    assert.equal(dropWindowLabel([live, soon], 'Mars/Olympus_Mons'), 'Aug 20 – 29');
  });
});

describe('dropArchive', () => {
  it('lists live and past drops newest first, never upcoming', () => {
    assert.deepEqual(dropArchive([past, soon, live], NOW).map((d) => d.id), ['live', 'past']);
  });
});
