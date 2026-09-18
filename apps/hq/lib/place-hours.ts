/**
 * Google's opening periods as the location form's per-day hours.
 *
 * Google numbers days from Sunday and describes a period as an open point and
 * a close point, which may be days apart; the form keys days from Monday and
 * files each span under the day it opens (location-hours.ts). So each period
 * is laid on a minute-of-the-week line and read back per day:
 *
 * - under a day long, it stays one span on its opening day, overnight when it
 *   runs past midnight (Friday 22:00 to Saturday 02:00 is Friday 22:00–02:00);
 * - a day or longer is cut at each midnight it crosses, and a whole day
 *   becomes the around-the-clock span;
 * - a period with no close is Google's way of saying the place never closes.
 *
 * Spans that touch or overlap on one day merge, so what comes out always
 * passes the form's own overlap check and the wizard never prefills a week it
 * would then refuse.
 */
import type { PlaceOpeningPeriod } from '@platform/engine';

import { ALL_DAY, WEEKDAYS, type HoursByDay, type HourSpan, type Weekday } from './location-hours';

const DAY = 24 * 60;
const WEEK = 7 * DAY;
/** Google's day numbers, 0 = Sunday, as the form's keys. */
const FROM_GOOGLE: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A stretch of one day: minutes past that day's midnight, `end` past 1440 when overnight. */
type Run = { readonly day: Weekday; start: number; end: number };

function minutes(clock: string): number {
  const [hours = 0, mins = 0] = clock.split(':').map(Number);
  return hours * 60 + mins;
}

function clock(total: number): string {
  const within = ((total % DAY) + DAY) % DAY;
  return `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`;
}

function dayAt(weekMinute: number): Weekday {
  return FROM_GOOGLE[Math.floor(weekMinute / DAY) % 7] ?? 'sun';
}

/** One period's runs, or null when it covers the whole week. */
function runsOf(period: PlaceOpeningPeriod): Run[] | null {
  if (period.close === null || period.closeDay === null) return null;
  const start = period.openDay * DAY + minutes(period.open);
  let end = period.closeDay * DAY + minutes(period.close);
  // Saturday night to Sunday morning closes on a smaller day number.
  if (end <= start) end += WEEK;
  if (end - start >= WEEK) return null;
  if (end - start < DAY) {
    const offset = start % DAY;
    return [{ day: dayAt(start), start: offset, end: offset + (end - start) }];
  }
  const runs: Run[] = [];
  for (let cursor = start; cursor < end;) {
    const midnight = (Math.floor(cursor / DAY) + 1) * DAY;
    const stop = Math.min(end, midnight);
    runs.push({ day: dayAt(cursor), start: cursor % DAY, end: (cursor % DAY) + (stop - cursor) });
    cursor = stop;
  }
  return runs;
}

function spanOf(run: { start: number; end: number }): HourSpan {
  // A whole day, or a merge that ran past one, is open around the clock.
  if (run.end - run.start >= DAY) return { ...ALL_DAY };
  return { open: clock(run.start), close: clock(run.end) };
}

function merged(runs: readonly Run[]): HourSpan[] {
  const ordered = [...runs].sort((a, b) => a.start - b.start);
  const joined: { start: number; end: number }[] = [];
  for (const run of ordered) {
    const last = joined[joined.length - 1];
    if (last && run.start <= last.end) last.end = Math.max(last.end, run.end);
    else joined.push({ start: run.start, end: run.end });
  }
  return joined.map(spanOf);
}

function allWeek(): HoursByDay {
  const hours: HoursByDay = {};
  for (const day of WEEKDAYS) hours[day] = [{ ...ALL_DAY }];
  return hours;
}

/** The week, or null when Google has no machine-readable hours for the place. */
export function hoursFromPeriods(periods: readonly PlaceOpeningPeriod[]): HoursByDay | null {
  if (periods.length === 0) return null;
  const runs: Run[] = [];
  for (const period of periods) {
    const cut = runsOf(period);
    if (cut === null) return allWeek();
    runs.push(...cut);
  }
  const hours: HoursByDay = {};
  for (const day of WEEKDAYS) {
    const today = runs.filter((run) => run.day === day);
    if (today.length > 0) hours[day] = merged(today);
  }
  return hours;
}
