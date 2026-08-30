/**
 * A shop's posted hours, read from the tenant config.
 *
 * These had been a hand-written table -- `SHOP_HOURS`, Sun-Thu 8am-11pm,
 * duplicated byte-for-byte in two apps -- while brand.json already carried the
 * same week as structured data. A second tenant open 6am to 2pm would have
 * been offered pickup windows until midnight, in both apps, with nothing to
 * change but a constant nobody would have thought to look for.
 *
 * A day is a list of spans, not one open/close pair, because brand.json says
 * so and because a shop that shuts between lunch and dinner must not sell a
 * 3pm pickup. An empty list is a day the shop is closed; a day the tenant
 * never wrote is a different thing, and the resolver says which it got.
 */
export type HourSpan = { openMinutes: number; closeMinutes: number };

/** Seven days of spans, Sunday-indexed to match `Date.prototype.getDay`. */
export type WeekHours = readonly (readonly HourSpan[])[];

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const MINUTES_PER_DAY = 24 * 60;

/**
 * "08:00" as minutes past local midnight, or null.
 *
 * Values past 24:00 are kept rather than wrapped: a Friday closing at 24:00 is
 * a longer Friday, and wrapping it to 0 would make the day close before it
 * opened. Callers add the minutes to local midnight, which resolves the
 * overflow into the following morning on its own.
 */
export function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (minutes > 59 || hours > 47) return null;
  return hours * 60 + minutes;
}

/**
 * "8am", "12am", "1:30am" -- the way hours are written on a door.
 *
 * brand.json writes a past-midnight close as 24:00 or 25:30 so a span is
 * always ordered; a guest reading a shop window has never seen either.
 * Anything unparseable is returned as written rather than guessed at, because
 * a wrong closing time is worse than an odd-looking one.
 */
export function formatClockLabel(value: string): string {
  const total = parseClockMinutes(value);
  if (total === null) return value;
  const wrapped = Math.floor(total / 60) % 24;
  const minutes = total % 60;
  const suffix = wrapped < 12 ? 'am' : 'pm';
  const twelve = wrapped % 12 === 0 ? 12 : wrapped % 12;
  return minutes === 0 ? `${twelve}${suffix}` : `${twelve}:${String(minutes).padStart(2, '0')}${suffix}`;
}

function spansOf(value: unknown): readonly HourSpan[] | null {
  if (!Array.isArray(value)) return null;
  const spans: HourSpan[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const openMinutes = parseClockMinutes((entry as { open?: unknown }).open);
    const closeMinutes = parseClockMinutes((entry as { close?: unknown }).close);
    if (openMinutes === null || closeMinutes === null) continue;
    if (closeMinutes <= openMinutes) continue;
    spans.push({ openMinutes, closeMinutes });
  }
  return spans.sort((a, b) => a.openMinutes - b.openMinutes);
}

/**
 * The week, or null when the tenant has not finished writing it.
 *
 * All-or-nothing on purpose. A partially filled week resolved to "closed on
 * the days you left out" would silently refuse orders on a day the shop is
 * open, and the app has an honest answer for not knowing -- it stops offering
 * windows and says hours are unavailable -- which a manager can act on.
 */
export function resolveWeekHours(config: unknown): WeekHours | null {
  if (typeof config !== 'object' || config === null) return null;
  const location = (config as { location?: unknown }).location;
  if (typeof location !== 'object' || location === null) return null;
  const hours = (location as { hours?: unknown }).hours;
  if (typeof hours !== 'object' || hours === null) return null;
  const week: (readonly HourSpan[])[] = [];
  for (const key of DAY_KEYS) {
    const spans = spansOf((hours as Record<string, unknown>)[key]);
    if (spans === null) return null;
    week.push(spans);
  }
  return week;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayLabel(spans: readonly HourSpan[]): string {
  if (spans.length === 0) return 'Closed';
  return spans
    .map((span) => `${formatClockLabel(clock(span.openMinutes))}–${formatClockLabel(clock(span.closeMinutes))}`)
    .join(', ');
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The week collapsed onto its runs, the way hours are written on a door.
 *
 * A shop open the same hours all week should read "Every day 8am–11pm", not
 * seven identical lines; one that differs at the weekend says so once. Reading
 * order starts at Monday, since that is how a posted week reads, even though
 * the array is Sunday-indexed to match `getDay`.
 */
export function summarizeWeek(hours: WeekHours | null): string | null {
  if (!hours || hours.length !== 7) return null;
  const reading = [1, 2, 3, 4, 5, 6, 0].map((index) => ({
    day: DAY_NAMES[index] ?? '', label: dayLabel(hours[index] ?? []),
  }));
  if (reading.every((entry) => entry.label === 'Closed')) return null;
  if (reading.every((entry) => entry.label === reading[0]?.label)) {
    return `Every day ${reading[0]?.label}`;
  }
  const runs: { from: string; to: string; label: string }[] = [];
  for (const entry of reading) {
    const last = runs[runs.length - 1];
    if (last && last.label === entry.label) last.to = entry.day;
    else runs.push({ from: entry.day, to: entry.day, label: entry.label });
  }
  return runs
    .map((run) => `${run.from === run.to ? run.from : `${run.from}–${run.to}`} ${run.label}`)
    .join(' · ');
}
