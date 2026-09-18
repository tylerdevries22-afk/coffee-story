/**
 * The per-day hours editor's state and edits, pure so they can be tested.
 *
 * The editor keeps every day, a closed one as an empty list, and may hold a
 * half-typed span while the operator fills it in. What it posts is checked by
 * location-hours.ts like any other input, so an unfinished row is refused with
 * a message -- never dropped, which would quietly close the location that day.
 */
import {
  ALL_DAY, checkDay, isAllDay, MAX_SPANS_PER_DAY, SPAN_ISSUES, WEEKDAYS,
  type HoursByDay, type HourSpan, type Weekday,
} from './location-hours';

export type WeekDraft = Readonly<Record<Weekday, readonly HourSpan[]>>;

/** What a day opens with when the operator switches it on. */
const STANDARD: Readonly<HourSpan> = { open: '08:00', close: '17:00' };

function copy(spans: readonly HourSpan[] | undefined): readonly HourSpan[] {
  return (spans ?? []).map(({ open, close }) => ({ open, close }));
}

export function weekFrom(hours: Readonly<HoursByDay>): WeekDraft {
  return {
    mon: copy(hours.mon), tue: copy(hours.tue), wed: copy(hours.wed), thu: copy(hours.thu),
    fri: copy(hours.fri), sat: copy(hours.sat), sun: copy(hours.sun),
  };
}

function withDay(week: WeekDraft, day: Weekday, spans: readonly HourSpan[]): WeekDraft {
  return { ...week, [day]: spans };
}

export function setSpan(
  week: WeekDraft, day: Weekday, index: number, field: keyof HourSpan, value: string,
): WeekDraft {
  return withDay(week, day, week[day].map((span, at) => (at === index ? { ...span, [field]: value } : span)));
}

export function setOpen(week: WeekDraft, day: Weekday, open: boolean): WeekDraft {
  return withDay(week, day, open ? [{ ...STANDARD }] : []);
}

export function setAllDay(week: WeekDraft, day: Weekday, allDay: boolean): WeekDraft {
  return withDay(week, day, [allDay ? { ...ALL_DAY } : { ...STANDARD }]);
}

/** A blank row to fill in; the form refuses it until both times are set. */
export function addSpan(week: WeekDraft, day: Weekday): WeekDraft {
  const spans = week[day];
  return spans.length >= MAX_SPANS_PER_DAY ? week : withDay(week, day, [...spans, { open: '', close: '' }]);
}

export function removeSpan(week: WeekDraft, day: Weekday, index: number): WeekDraft {
  return withDay(week, day, week[day].filter((_, at) => at !== index));
}

export function dayIsAllDay(spans: readonly HourSpan[]): boolean {
  const [only] = spans;
  return spans.length === 1 && only !== undefined && isAllDay(only);
}

/** The first thing wrong with a day, in the words the server would use. */
export function dayIssue(spans: readonly HourSpan[]): string | null {
  const checked = checkDay(spans);
  return checked.ok ? null : SPAN_ISSUES[checked.issue];
}

/** What the form posts: every day, a closed one as an empty list. */
export function weekJson(week: WeekDraft): string {
  return JSON.stringify(Object.fromEntries(WEEKDAYS.map((day) => [day, week[day]])));
}
