/**
 * The rotating-drop model: a scheduled, limited-run feature item. Pure and
 * asset-free; screens map `itemId` onto catalog imagery.
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

/**
 * The date-range chip over the drop board, spanning the earliest start to the
 * latest end: "Aug 18 – 24" within a month, "Aug 30 – Sep 5" across one.
 *
 * The zone is required, not defaulted. A drop window is a shop-local fact --
 * "this week's lineup" means the week the shop is having, not the one the
 * guest's phone is in -- and this module cannot know which shop it is being
 * asked about. It used to answer America/Denver for all of them, so the second
 * tenant's board would have been labelled in the first tenant's week. Callers
 * pass `useBusiness().timezone`, which reads the tenant's own config.
 *
 * Every part is read in one explicit zone. This used to mix `getDate()` and
 * `toLocaleDateString()`, both of which read the *device's* zone: a window
 * starting at midnight UTC rendered as the day before anywhere west of it, so
 * a Denver guest saw a drop labelled a day early and the test only passed on a
 * UTC machine.
 */
export function dropWindowLabel(
  drops: readonly Drop[],
  timeZone: string,
): string {
  const starts = drops.map((drop) => new Date(drop.startsAt)).filter((date) => !Number.isNaN(date.getTime()));
  const ends = drops.map((drop) => new Date(drop.endsAt)).filter((date) => !Number.isNaN(date.getTime()));
  if (!starts.length || !ends.length) return '';
  const from = new Date(Math.min(...starts.map((date) => date.getTime())));
  const to = new Date(Math.max(...ends.map((date) => date.getTime())));

  const partsOf = (date: Date) => {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone, month: 'short', day: 'numeric', year: 'numeric',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      formatted.find((entry) => entry.type === type)?.value ?? '';
    return { month: part('month'), day: part('day'), year: part('year') };
  };

  const a = partsOf(from);
  const b = partsOf(to);
  const sameMonth = a.month === b.month && a.year === b.year;
  return sameMonth
    ? `${a.month} ${a.day} – ${b.day}`
    : `${a.month} ${a.day} – ${b.month} ${b.day}`;
}

/** Newest first, for the archive screen. Includes the live drop. */
export function dropArchive(drops: readonly Drop[], now: Date): Drop[] {
  return drops
    .filter((drop) => dropStatus(drop, now) !== 'upcoming')
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
}
