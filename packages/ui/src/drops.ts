/**
 * The rotating-drop model: a scheduled, limited-run feature item. Pure and
 * asset-free; screens map `itemId` onto catalog imagery.
 *
 * Promoted out of the two Expo apps, which each carried a near-copy of
 * `src/features/drops.ts`. The window label had to be fixed in one place
 * to stay fixed, so the whole module lives here now (CLAUDE.md: new shared
 * code goes in packages/*, and duplicated modules get promoted rather than
 * edited twice).
 */
export type DropStatus = 'upcoming' | 'live' | 'ended';

export type Drop = {
  id: string;
  itemId: string;
  title: string;
  blurb: string;
  startsAt: string;  // ISO
  endsAt: string;    // ISO
};

export function dropStatus(drop: Drop, now: Date): DropStatus {
  const starts = new Date(drop.startsAt);
  const ends = new Date(drop.endsAt);
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return 'ended';
  if (now < starts) return 'upcoming';
  if (now < ends) return 'live';
  return 'ended';
}

/** The drop the home hero features: live first, else the next upcoming. */
export function featuredDrop(drops: readonly Drop[], now: Date): Drop | null {
  const live = drops
    .filter((drop) => dropStatus(drop, now) === 'live')
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
  if (live[0]) return live[0];
  const upcoming = drops
    .filter((drop) => dropStatus(drop, now) === 'upcoming')
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return upcoming[0] ?? null;
}

/**
 * The week's drop board: everything live now plus what's about to land,
 * soonest-ending first. The home page renders these as a dated section.
 */
export function weeklyDrops(drops: readonly Drop[], now: Date): Drop[] {
  const live = drops
    .filter((drop) => dropStatus(drop, now) === 'live')
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
  const upcoming = drops
    .filter((drop) => dropStatus(drop, now) === 'upcoming')
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return [...live, ...upcoming];
}

/** The calendar day an instant lands on in one zone, as rendered parts. */
type ZonedDay = { year: number; month: string; day: number };

/**
 * `locations.timezone` is free text with no check constraint and onboarding
 * only asserts it contains a slash, so a typo reaches the client -- where
 * `Intl` answers a bad zone with a RangeError. The board degrades to UTC
 * rather than throwing under the hero, matching the engine's own fallback
 * for a location with no zone recorded.
 */
function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone });
  } catch {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' });
  }
}

function zonedDay(instant: Date, format: Intl.DateTimeFormat): ZonedDay {
  const parts = format.formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { year: Number(value('year')), month: value('month'), day: Number(value('day')) };
}

/**
 * The date-range chip over the drop board, spanning the earliest start to the
 * latest end: "Aug 18 – 24" within a month, "Aug 30 – Sep 5" across one.
 *
 * Rendered in the *location's* zone, never the device's. A drop window is a
 * fact about a physical shop -- the morning it starts pouring -- so the guest
 * standing in the shop and the one reading the board from another state must
 * see the same day. Formatting through the device clock instead showed every
 * guest west of UTC a window that opened a day early: a drop the shop
 * advertised as opening the 20th read "Aug 19" on every phone in Colorado,
 * and CI never saw it because CI runs UTC.
 */
export function dropWindowLabel(drops: readonly Drop[], timeZone: string): string {
  const starts = drops.map((drop) => new Date(drop.startsAt)).filter((date) => !Number.isNaN(date.getTime()));
  const ends = drops.map((drop) => new Date(drop.endsAt)).filter((date) => !Number.isNaN(date.getTime()));
  if (!starts.length || !ends.length) return '';
  const format = dayFormatter(timeZone);
  const from = zonedDay(new Date(Math.min(...starts.map((date) => date.getTime()))), format);
  const to = zonedDay(new Date(Math.max(...ends.map((date) => date.getTime()))), format);
  // Short month names are unique within a year, so they stand in for the
  // month number the formatter cannot emit alongside them.
  const sameMonth = from.month === to.month && from.year === to.year;
  return sameMonth
    ? `${from.month} ${from.day} – ${to.day}`
    : `${from.month} ${from.day} – ${to.month} ${to.day}`;
}

/** Newest first, for the archive screen. Includes the live drop. */
export function dropArchive(drops: readonly Drop[], now: Date): Drop[] {
  return drops
    .filter((drop) => dropStatus(drop, now) !== 'upcoming')
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
}
