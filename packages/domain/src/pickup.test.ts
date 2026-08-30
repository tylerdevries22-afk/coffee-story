import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import coffeeStory from '../../../tenants/coffee-story/brand.json';
import { resolveWeekHours } from './hours';
import {
  PICKUP_HORIZON_DAYS,
  PICKUP_LEAD_MINUTES,
  PICKUP_STEP_MINUTES,
  PICKUP_WINDOW_MINUTES,
  describePickupWindow,
  pickupSchedule,
  pickupTimeLabel,
  isWindowStillBookable,
  type PickupWindow,
} from './pickup';

// Coffee Story's own week, read from the tenant folder rather than restated
// here: these tests assert that the schedule honours the hours it was given,
// and a second copy of the week could only ever drift from the first.
const SHOP_HOURS = resolveWeekHours(coffeeStory);
const { hoursForDay, pickupWindows, shopStatus } = pickupSchedule(SHOP_HOURS);

/** A local wall-clock instant, so the tests read the way the shop does. */
function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// 2026-08-19 is a Wednesday; 2026-08-21 a Friday; 2026-08-22 a Saturday.
const wednesday = (hour: number, minute = 0) => at(2026, 8, 19, hour, minute);
const friday = (hour: number, minute = 0) => at(2026, 8, 21, hour, minute);

/**
 * Index into a window list, asserting rather than trusting.
 *
 * `packages/domain` checks indexed access, so `windows[0]` is `PickupWindow |
 * undefined` here where it was `PickupWindow` in the app this module came
 * from. Asserting keeps a schedule that returns nothing an explicit failure
 * instead of a `Cannot read properties of undefined` further down.
 */
function nth(windows: readonly PickupWindow[], index: number): PickupWindow {
  const window = windows[index];
  assert.ok(window, `expected a pickup window at ${index}`);
  return window;
}

/** The earliest window the schedule offers from `now`. */
function firstWindow(now: Date): PickupWindow {
  return nth(pickupWindows(now, 1), 0);
}

describe('the tenant week', () => {
  it('opens at 8am every day', () => {
    for (const day of SHOP_HOURS ?? []) assert.equal(day[0]?.openMinutes, 8 * 60);
  });

  it('closes at 11pm Sunday through Thursday and midnight Friday and Saturday', () => {
    assert.deepEqual(
      (SHOP_HOURS ?? []).map((day) => (day[0]?.closeMinutes ?? 0) / 60),
      [23, 23, 23, 23, 23, 24, 24],
    );
  });

  it('reads the right row for a given day', () => {
    assert.equal(hoursForDay(wednesday(12))[0]?.closeMinutes, 23 * 60);
    assert.equal(hoursForDay(friday(12))[0]?.closeMinutes, 24 * 60);
  });
});

describe('pickupTimeLabel', () => {
  it('states the meridiem once when both ends share it', () => {
    assert.equal(pickupTimeLabel(wednesday(17, 30)), '5:30 – 6:00 PM');
  });

  it('states both when the window crosses noon or midnight', () => {
    assert.equal(pickupTimeLabel(wednesday(11, 45)), '11:45 AM – 12:15 PM');
  });
});

describe('pickupWindows', () => {
  it('starts no sooner than the bar can make the drink', () => {
    const first = firstWindow(wednesday(17, 4));
    const earliest = new Date(wednesday(17, 4).getTime() + PICKUP_LEAD_MINUTES * 60_000);
    assert.ok(new Date(first.value) >= earliest);
  });

  it('lands on the quarter-hour grid', () => {
    for (const window of pickupWindows(wednesday(17, 4), 8)) {
      assert.equal(new Date(window.value).getMinutes() % PICKUP_STEP_MINUTES, 0);
    }
  });

  it('steps by the grid interval', () => {
    const windows = pickupWindows(wednesday(12), 4);
    for (let index = 1; index < windows.length; index += 1) {
      const gap = new Date(nth(windows, index).value).getTime() - new Date(nth(windows, index - 1).value).getTime();
      assert.equal(gap, PICKUP_STEP_MINUTES * 60_000);
    }
  });

  it('labels the first windows of the day Today', () => {
    const first = firstWindow(wednesday(12));
    assert.equal(first.dayLabel, 'Today');
    assert.equal(first.timeLabel, '12:30 – 1:00 PM');
  });

  it('leaves enough time to complete checkout before lead-time revalidation', () => {
    const first = firstWindow(wednesday(12));
    assert.equal(isWindowStillBookable(first.value, wednesday(12, 4)), true);
  });

  it('waits for opening when the shop is still shut', () => {
    const first = firstWindow(wednesday(5));
    assert.equal(new Date(first.value).getHours(), 8);
    assert.equal(new Date(first.value).getMinutes(), 0);
    assert.equal(first.dayLabel, 'Today');
  });

  it('never promises a window that ends after close', () => {
    for (const window of pickupWindows(wednesday(22, 30), 6)) {
      const ends = new Date(new Date(window.value).getTime() + PICKUP_WINDOW_MINUTES * 60_000);
      const closeMinutes = hoursForDay(new Date(window.value))[0]?.closeMinutes ?? 0;
      const closesAt = new Date(new Date(window.value));
      closesAt.setHours(0, closeMinutes, 0, 0);
      assert.ok(ends <= closesAt, `${window.dayLabel} ${window.timeLabel} ends after close`);
    }
  });

  it('rolls into tomorrow once the last window of today has gone', () => {
    const windows = pickupWindows(wednesday(22, 45), 3);
    assert.deepEqual(windows.map((window) => window.dayLabel), ['Tomorrow', 'Tomorrow', 'Tomorrow']);
    assert.equal(nth(windows, 0).timeLabel, '8:00 – 8:30 AM');
  });

  it('uses the later Friday close before rolling over', () => {
    const first = firstWindow(friday(23, 10));
    assert.equal(first.dayLabel, 'Today');
    assert.equal(first.timeLabel, '11:30 PM – 12:00 AM');
  });

  it('returns the number asked for, up to the horizon', () => {
    assert.equal(pickupWindows(wednesday(12), 12).length, 12);
    assert.equal(pickupWindows(wednesday(12), 0).length, 0);
    assert.equal(pickupWindows(new Date('nonsense'), 4).length, 0);
  });

  it('never reaches past the horizon it advertises', () => {
    const windows = pickupWindows(wednesday(22, 45), 500);
    const last = new Date(nth(windows, windows.length - 1).value);
    const horizonEnd = new Date(wednesday(22, 45).getTime());
    horizonEnd.setDate(horizonEnd.getDate() + PICKUP_HORIZON_DAYS + 1);
    horizonEnd.setHours(0, 0, 0, 0);
    assert.ok(last < horizonEnd);
  });
});

describe('describePickupWindow', () => {
  it('relabels a stored window against the current day', () => {
    const first = firstWindow(wednesday(12));
    assert.deepEqual(describePickupWindow(first.value, wednesday(12)), first);
  });

  it('calls yesterday\'s window by its weekday, not Today', () => {
    const first = firstWindow(wednesday(12));
    const described = describePickupWindow(first.value, at(2026, 8, 21, 12));
    assert.equal(described?.dayLabel, 'Wed');
  });

  it('returns null for a value that is not a time', () => {
    assert.equal(describePickupWindow('not-a-time', wednesday(12)), null);
  });
});

describe('shopStatus', () => {
  it('says the bar is pouring during opening hours', () => {
    assert.deepEqual(shopStatus(wednesday(12)), { open: true, label: 'Now brewing' });
  });

  it('names the opening time before the shop opens', () => {
    assert.deepEqual(shopStatus(wednesday(6, 30)), { open: false, label: 'Opens 8:00 AM' });
  });

  it('does not claim to be pouring after a weekday close', () => {
    // 11pm Sunday-Thursday. The badge used to read "Now Brewing" here.
    assert.deepEqual(shopStatus(wednesday(23, 30)), { open: false, label: 'Opens 8:00 AM tomorrow' });
  });

  it('is still open at 11:30pm on a Friday, when the shop closes at midnight', () => {
    assert.equal(shopStatus(friday(23, 30)).open, true);
  });

  it('closes exactly on the hour rather than a minute past it', () => {
    assert.equal(shopStatus(wednesday(22, 59)).open, true);
    assert.equal(shopStatus(wednesday(23, 0)).open, false);
  });

  it('reports unavailable rather than guessing for an invalid clock', () => {
    assert.deepEqual(shopStatus(new Date('nonsense')), { open: false, label: 'Hours unavailable' });
  });
});

describe('isWindowStillBookable', () => {
  it('accepts a window that is still at least the lead time away', () => {
    const first = firstWindow(wednesday(12));
    assert.equal(isWindowStillBookable(first.value, wednesday(12)), true);
  });

  it('rejects a window whose start has already gone', () => {
    // The failure this exists for: a guest picks the earliest slot, spends
    // forty minutes on a sixty-item menu, and places the order against a time
    // that has been and gone -- which files it under Past orders on arrival.
    const first = firstWindow(wednesday(12));
    assert.equal(isWindowStillBookable(first.value, wednesday(13)), false);
  });

  it('rejects a window too close to make in time', () => {
    const first = firstWindow(wednesday(12));
    const start = new Date(first.value);
    const almost = new Date(start.getTime() - (PICKUP_LEAD_MINUTES - 1) * 60_000);
    assert.equal(isWindowStillBookable(first.value, almost), false);
  });

  it('rejects a value that is not a time, and a clock that is not one either', () => {
    assert.equal(isWindowStillBookable('nonsense', wednesday(12)), false);
    const first = firstWindow(wednesday(12));
    assert.equal(isWindowStillBookable(first.value, new Date('nonsense')), false);
  });
});
