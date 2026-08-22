/** Pure countdown math for DropCountdown, reachable from node:test. */

export type DropPhase = 'upcoming' | 'live' | 'ended';

export function dropPhase(startsAt: Date, endsAt: Date, now: Date): DropPhase {
  if (now < startsAt) return 'upcoming';
  if (now < endsAt) return 'live';
  return 'ended';
}

/**
 * "2d 4h" above a day, "4h 12m" above an hour, "12:07" under one -- the
 * nearer the moment, the finer the grain.
 */
export function formatCountdown(target: Date, now: Date): string {
  const ms = Math.max(0, target.getTime() - now.getTime());
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
