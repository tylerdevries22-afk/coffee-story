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
 */
export function dropWindowLabel(drops: readonly Drop[]): string {
  const starts = drops.map((drop) => new Date(drop.startsAt)).filter((date) => !Number.isNaN(date.getTime()));
  const ends = drops.map((drop) => new Date(drop.endsAt)).filter((date) => !Number.isNaN(date.getTime()));
  if (!starts.length || !ends.length) return '';
  const from = new Date(Math.min(...starts.map((date) => date.getTime())));
  const to = new Date(Math.max(...ends.map((date) => date.getTime())));
  const month = (date: Date) => date.toLocaleDateString('en-US', { month: 'short' });
  const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
  return sameMonth
    ? `${month(from)} ${from.getDate()} – ${to.getDate()}`
    : `${month(from)} ${from.getDate()} – ${month(to)} ${to.getDate()}`;
}

/** Newest first, for the archive screen. Includes the live drop. */
export function dropArchive(drops: readonly Drop[], now: Date): Drop[] {
  return drops
    .filter((drop) => dropStatus(drop, now) !== 'upcoming')
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
}
