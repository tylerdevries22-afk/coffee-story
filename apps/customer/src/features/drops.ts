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

/** Newest first, for the archive screen. Includes the live drop. */
export function dropArchive(drops: readonly Drop[], now: Date): Drop[] {
  return drops
    .filter((drop) => dropStatus(drop, now) !== 'upcoming')
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
}
