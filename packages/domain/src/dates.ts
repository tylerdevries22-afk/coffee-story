/**
 * Calendar dates, in the timezone the person is standing in.
 *
 * `date.toISOString().slice(0, 10)` is the obvious way to get a `YYYY-MM-DD`
 * and it is wrong for a calendar day: it converts to UTC first. Everywhere the
 * studio operates is behind UTC, so from late afternoon onward the UTC date has
 * already rolled over and the string names tomorrow. A chip labelled "Today"
 * from local parts then carries tomorrow's value.
 *
 * These are the calendar-day helpers; anything that needs a precise instant
 * should keep using ISO timestamps.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for the LOCAL calendar day, never shifted by the UTC offset. */
export function localIsoDate(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('a valid date is required');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` for an instant in a named IANA timezone. */
export function isoDateInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('a valid date is required');
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: 'gregory',
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  if (!year || !month || !day) throw new RangeError('the calendar date could not be formatted');
  return `${year}-${month}-${day}`;
}

/** The same local calendar day, `offset` days later. */
export function addLocalDays(date: Date, offset: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + offset);
  return next;
}

/** Days offered in the pickup date row. */
export const SELECTABLE_DAYS = 7;

export type UpcomingDate = { value: string; label: string };

export type NativePickerOption = { value: string; label: string };

/** `HH:mm` for a local time picker, without shifting the instant to UTC. */
export function localIsoTime(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('a valid date is required');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Replace the local calendar date and clock time while returning an ISO instant. */
export function replaceLocalDateTime(iso: string, dateValue: string, timeValue: string): string {
  const current = new Date(iso);
  if (Number.isNaN(current.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !/^\d{2}:\d{2}$/.test(timeValue)) {
    throw new RangeError('a valid date, time, and ISO value are required');
  }
  const next = new Date(`${dateValue}T${timeValue}:00`);
  if (Number.isNaN(next.getTime())) throw new RangeError('a valid date and time are required');
  return next.toISOString();
}

/**
 * Consecutive selectable days starting from `from`.
 *
 * `value` and `label` are derived from the same local day, which is the whole
 * point: they used to disagree, the label formatted locally and the value in
 * UTC.
 */
export function upcomingDates(from: Date, count: number): UpcomingDate[] {
  if (!Number.isFinite(count) || count < 1) return [];
  const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' });
  return Array.from({ length: Math.floor(count) }, (_, index) => {
    const day = addLocalDays(from, index);
    return {
      value: localIsoDate(day),
      label: index === 0 ? 'Today' : formatter.format(day),
    };
  });
}
