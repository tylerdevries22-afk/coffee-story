import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlaceOpeningPeriod } from '@platform/engine';

import { parseHoursByDay } from './location-hours';
import { hoursFromPeriods } from './place-hours';

/** Google's numbering: 0 is Sunday. */
const SUN = 0, MON = 1, TUE = 2, WED = 3, FRI = 5, SAT = 6;

function period(openDay: number, open: string, closeDay: number | null, close: string | null): PlaceOpeningPeriod {
  return { openDay, open, closeDay, close };
}

describe('Google opening periods as per-day hours', () => {
  it('moves Google’s Sunday-first days onto the form’s Monday-first keys', () => {
    assert.deepEqual(hoursFromPeriods([
      period(MON, '08:00', MON, '17:00'),
      period(SAT, '09:00', SAT, '14:00'),
      period(SUN, '10:00', SUN, '13:00'),
    ]), {
      mon: [{ open: '08:00', close: '17:00' }],
      sat: [{ open: '09:00', close: '14:00' }],
      sun: [{ open: '10:00', close: '13:00' }],
    });
  });

  it('files a span past midnight under the day it opened', () => {
    assert.deepEqual(hoursFromPeriods([period(FRI, '22:00', SAT, '02:00')]),
      { fri: [{ open: '22:00', close: '02:00' }] });
  });

  it('wraps Saturday night into Sunday morning', () => {
    assert.deepEqual(hoursFromPeriods([period(SAT, '22:00', SUN, '02:00')]),
      { sat: [{ open: '22:00', close: '02:00' }] });
  });

  it('writes a close at midnight as 00:00 on the opening day', () => {
    assert.deepEqual(hoursFromPeriods([period(FRI, '18:00', SAT, '00:00')]),
      { fri: [{ open: '18:00', close: '00:00' }] });
  });

  it('reads a period with no close as open around the clock, every day', () => {
    const allDay = [{ open: '00:00', close: '23:59' }];
    assert.deepEqual(hoursFromPeriods([period(SUN, '00:00', null, null)]), {
      mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay,
    });
  });

  it('cuts a period of a day or more at each midnight', () => {
    assert.deepEqual(hoursFromPeriods([period(MON, '00:00', WED, '00:00')]), {
      mon: [{ open: '00:00', close: '23:59' }], tue: [{ open: '00:00', close: '23:59' }],
    });
    assert.deepEqual(hoursFromPeriods([period(MON, '08:00', TUE, '10:00')]), {
      mon: [{ open: '08:00', close: '00:00' }], tue: [{ open: '00:00', close: '10:00' }],
    });
    assert.deepEqual(hoursFromPeriods([period(SAT, '20:00', MON, '02:00')]), {
      mon: [{ open: '00:00', close: '02:00' }],
      sat: [{ open: '20:00', close: '00:00' }],
      sun: [{ open: '00:00', close: '23:59' }],
    });
  });

  it('keeps a split day as two spans and merges spans that touch', () => {
    assert.deepEqual(hoursFromPeriods([
      period(TUE, '13:00', TUE, '17:00'),
      period(TUE, '08:00', TUE, '12:00'),
      period(WED, '08:00', WED, '12:00'),
      period(WED, '12:00', WED, '16:00'),
    ]), {
      tue: [{ open: '08:00', close: '12:00' }, { open: '13:00', close: '17:00' }],
      wed: [{ open: '08:00', close: '16:00' }],
    });
  });

  it('is null when Google has no machine-readable hours', () => {
    assert.equal(hoursFromPeriods([]), null);
  });

  it('only ever prefills a week the form itself accepts', () => {
    const weeks = [
      [period(FRI, '22:00', SAT, '02:00'), period(FRI, '11:00', FRI, '15:00')],
      [period(MON, '08:00', TUE, '10:00'), period(TUE, '09:00', TUE, '17:00')],
      [period(SAT, '20:00', MON, '02:00'), period(SUN, '09:00', SUN, '12:00')],
      [period(SUN, '00:00', null, null)],
    ];
    for (const week of weeks) {
      const hours = hoursFromPeriods(week);
      assert.ok(hours);
      assert.equal(parseHoursByDay(hours).ok, true, JSON.stringify(hours));
    }
  });
});
