/**
 * Opening hours as the location form and the `locations.hours` column hold
 * them: per weekday from Monday, a list of spans, each an `open`/`close` pair
 * of 24-hour `HH:MM` clocks. A day with no spans is closed and is left out,
 * which is what the quick one-span form has always written.
 *
 * Two shapes a single pair has to be able to say:
 *
 * - Overnight. A close earlier than its open is the next morning: Friday
 *   22:00–02:00 runs from Friday 10pm to Saturday 2am and is filed under the
 *   day it opened. A time input cannot hold 26:00, so this is what an operator
 *   can type, and it is what the database's operation scheduler already reads
 *   (it adds a day whenever `close <= open`). brand.json orders the same span
 *   past midnight instead, because `@platform/domain` drops a close that sorts
 *   before its open -- so the tenant pack writer converts with `packSpan`.
 * - Around the clock: 00:00–23:59, the whole-day span the committed tenants
 *   already use and the lobby screen already reads as "Open 24 hours".
 *
 * A span that opens and closes at the same minute is refused. It means either
 * nothing or all day, and guessing which is how a shop ends up closed all week.
 */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type HourSpan = { open: string; close: string };
export type HoursByDay = Partial<Record<Weekday, HourSpan[]>>;

export const ALL_DAY: Readonly<HourSpan> = { open: '00:00', close: '23:59' };
export const MAX_SPANS_PER_DAY = 4;

export const DAY_LABEL: Readonly<Record<Weekday, string>> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};
export const DAY_NAME: Readonly<Record<Weekday, string>> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday',
  sat: 'Saturday', sun: 'Sunday',
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MINUTES = 24 * 60;
/** Seven days of four spans is well under this; anything longer is not hours. */
const RAW_MAX = 4_096;
const UNREADABLE = 'The hours could not be read. Reload the form and try again.';
export const NO_OPEN_DAY = 'Pick at least one day the location is open.';

export type SpanIssue = 'format' | 'same_minute' | 'overlap' | 'too_many';
export const SPAN_ISSUES: Readonly<Record<SpanIssue, string>> = {
  format: 'Enter each opening and closing time as HH:MM.',
  same_minute: 'Opening and closing times can’t be the same. For a location that never closes, use 00:00 to 23:59.',
  overlap: 'Two sets of hours on the same day overlap.',
  too_many: `List at most ${MAX_SPANS_PER_DAY} sets of hours a day.`,
};

export function isClock(value: string): boolean {
  return TIME.test(value);
}

function minutesOf(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number);
  return hours * 60 + minutes;
}

/** True when the span closes after midnight, on the following day. */
export function crossesMidnight(span: HourSpan): boolean {
  return minutesOf(span.close) < minutesOf(span.open);
}

export function isAllDay(span: HourSpan): boolean {
  return span.open === ALL_DAY.open && span.close === ALL_DAY.close;
}

/** Minutes past the opening day's midnight at which the span closes. */
function closesAt(span: HourSpan): number {
  return minutesOf(span.close) + (crossesMidnight(span) ? DAY_MINUTES : 0);
}

/** One day's spans in opening order, or the first thing wrong with them. */
export function checkDay(spans: readonly HourSpan[]):
  { ok: true; spans: HourSpan[] } | { ok: false; issue: SpanIssue } {
  if (spans.length > MAX_SPANS_PER_DAY) return { ok: false, issue: 'too_many' };
  for (const span of spans) {
    if (!isClock(span.open) || !isClock(span.close)) return { ok: false, issue: 'format' };
    if (span.open === span.close) return { ok: false, issue: 'same_minute' };
  }
  const sorted = [...spans].sort((a, b) => minutesOf(a.open) - minutesOf(b.open));
  // An overnight span can only be a day's last: it is still open at every
  // later opening that day, which this reads as the overlap it is.
  const overlaps = sorted.some((span, index) => {
    const previous = sorted[index - 1];
    return previous !== undefined && closesAt(previous) > minutesOf(span.open);
  });
  if (overlaps) return { ok: false, issue: 'overlap' };
  return { ok: true, spans: sorted.map(({ open, close }) => ({ open, close })) };
}

function spanOf(value: unknown): HourSpan | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { open, close } = value as Record<string, unknown>;
  return typeof open === 'string' && typeof close === 'string'
    ? { open: open.trim(), close: close.trim() }
    : null;
}

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

/**
 * Per-day spans as the wizard posts them: a JSON object keyed by weekday, or
 * that object itself.
 *
 * Strict on shape. An unknown day or a span missing a field is refused rather
 * than dropped, because a dropped span is a day the location silently stops
 * being open -- and the operator never sees that it happened.
 */
export function parseHoursByDay(raw: unknown):
  { ok: true; hours: HoursByDay } | { ok: false; error: string } {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.length > RAW_MAX) return { ok: false, error: UNREADABLE };
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: UNREADABLE };
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: UNREADABLE };
  }
  const days = value as Record<string, unknown>;
  if (!Object.keys(days).every(isWeekday)) return { ok: false, error: UNREADABLE };
  const hours: HoursByDay = {};
  for (const day of WEEKDAYS) {
    const listed = days[day];
    if (listed === undefined) continue;
    if (!Array.isArray(listed)) return { ok: false, error: UNREADABLE };
    const spans = listed.map(spanOf).filter((span): span is HourSpan => span !== null);
    if (spans.length !== listed.length) return { ok: false, error: UNREADABLE };
    const checked = checkDay(spans);
    if (!checked.ok) return { ok: false, error: `${DAY_NAME[day]}: ${SPAN_ISSUES[checked.issue]}` };
    if (checked.spans.length > 0) hours[day] = checked.spans;
  }
  if (Object.keys(hours).length === 0) return { ok: false, error: NO_OPEN_DAY };
  return { ok: true, hours };
}

function spanLabel(span: HourSpan): string {
  return isAllDay(span) ? '24 hours' : `${span.open}–${span.close}`;
}

/**
 * The week as the console lists it: days that share hours read once, in
 * weekday order -- "Mon Tue Wed Thu Fri 08:00–17:00 · Sat 09:00–14:00".
 */
export function hoursSummary(hours: HoursByDay): string {
  const groups = new Map<string, Weekday[]>();
  for (const day of WEEKDAYS) {
    const spans = hours[day];
    if (!spans || spans.length === 0) continue;
    const label = spans.map(spanLabel).join(', ');
    groups.set(label, [...(groups.get(label) ?? []), day]);
  }
  return [...groups]
    .map(([label, days]) => `${days.map((day) => DAY_LABEL[day]).join(' ')} ${label}`)
    .join(' · ');
}

/**
 * The same span in brand.json's convention, where a close after midnight is
 * written past 24:00 so every span sorts open-before-close: 22:00–02:00
 * becomes 22:00–26:00, and a close at midnight becomes 24:00, as the committed
 * tenants already write it.
 */
export function packSpan(span: HourSpan): HourSpan {
  if (!crossesMidnight(span)) return { open: span.open, close: span.close };
  const close = minutesOf(span.close) + DAY_MINUTES;
  return {
    open: span.open,
    close: `${Math.floor(close / 60)}:${String(close % 60).padStart(2, '0')}`,
  };
}
