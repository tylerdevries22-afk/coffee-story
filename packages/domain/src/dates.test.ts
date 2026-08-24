import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addLocalDays, localIsoDate, localIsoTime, replaceLocalDateTime, upcomingDates } from './dates';

/** The local Y-M-D of an instant, built independently of the module under test. */
function localParts(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

test('localIsoDate always names the local calendar day', () => {
  // Sampled across a year at odd hours so at least some land after the UTC
  // rollover in any negative-offset zone.
  for (let day = 0; day < 365; day += 7) {
    for (const hour of [0, 1, 12, 17, 19, 22, 23]) {
      const date = new Date(2026, 0, 1 + day, hour, 30);
      assert.equal(localIsoDate(date), localParts(date));
    }
  }
});

test('the UTC shortcut disagrees in the evening, which is the bug', () => {
  const offset = new Date(2026, 6, 15, 23, 30).getTimezoneOffset();
  if (offset === 0) {
    // In UTC the two agree by definition; there is nothing to demonstrate.
    return;
  }
  const evening = new Date(2026, 6, 15, 23, 30);
  const utcShortcut = evening.toISOString().slice(0, 10);
  if (offset > 0) {
    // Behind UTC (the Americas, including the studio's America/Denver).
    assert.notEqual(utcShortcut, localIsoDate(evening));
    assert.equal(localIsoDate(evening), '2026-07-15');
  }
});

test('a pickup chip labelled Today carries today', () => {
  // The user-visible failure: after ~5pm Denver the "Today" chip sent
  // tomorrow's date to the availability API and to demoSlotFor.
  const evening = new Date(2026, 6, 15, 21, 0);
  const [first] = upcomingDates(evening, 7);
  assert.ok(first, 'upcomingDates must return at least one chip');
  assert.equal(first.label, 'Today');
  assert.equal(first.value, localIsoDate(evening));
  assert.equal(first.value, '2026-07-15');
});

test('every chip value matches its own label day', () => {
  const from = new Date(2026, 6, 15, 22, 0);
  const dates = upcomingDates(from, 7);
  dates.forEach((entry, index) => {
    assert.equal(entry.value, localIsoDate(addLocalDays(from, index)));
  });
});

test('chips are consecutive, unique and ascending', () => {
  const dates = upcomingDates(new Date(2026, 6, 15, 9, 0), 7);
  assert.equal(dates.length, 7);
  assert.equal(new Set(dates.map((d) => d.value)).size, 7);
  const sorted = [...dates].sort((a, b) => a.value.localeCompare(b.value));
  assert.deepEqual(dates.map((d) => d.value), sorted.map((d) => d.value));
});

test('crossing a month boundary rolls the month, not the day number', () => {
  const dates = upcomingDates(new Date(2026, 0, 30, 12, 0), 4);
  assert.deepEqual(dates.map((d) => d.value), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
});

test('crossing a year boundary rolls the year', () => {
  const dates = upcomingDates(new Date(2026, 11, 31, 12, 0), 2);
  assert.deepEqual(dates.map((d) => d.value), ['2026-12-31', '2027-01-01']);
});

test('a leap day is a real day', () => {
  const dates = upcomingDates(new Date(2028, 1, 28, 12, 0), 2);
  assert.deepEqual(dates.map((d) => d.value), ['2028-02-28', '2028-02-29']);
});

test('addLocalDays does not mutate its argument', () => {
  const from = new Date(2026, 6, 15, 12, 0);
  const before = from.getTime();
  addLocalDays(from, 5);
  assert.equal(from.getTime(), before);
});

test('a non-positive count yields nothing rather than throwing', () => {
  assert.deepEqual(upcomingDates(new Date(2026, 6, 15), 0), []);
  assert.deepEqual(upcomingDates(new Date(2026, 6, 15), -3), []);
  assert.deepEqual(upcomingDates(new Date(2026, 6, 15), Number.NaN), []);
});

test('an invalid date is rejected rather than yielding "NaN-NaN-NaN"', () => {
  assert.throws(() => localIsoDate(new Date('nope')), RangeError);
});

test('localIsoTime preserves the local clock shown to a picker', () => {
  assert.equal(localIsoTime(new Date(2026, 6, 15, 9, 5)), '09:05');
});

test('replaceLocalDateTime combines native date and time selections', () => {
  const result = new Date(replaceLocalDateTime('2026-07-15T09:05:00.000Z', '2026-07-18', '14:30'));
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 6);
  assert.equal(result.getDate(), 18);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 30);
});
