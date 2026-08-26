export type BoardFreshness = 'live' | 'stale' | 'fixtures';

/** A configured read failure always wins over fixture/live presentation. */
export function boardFreshness(
  live: boolean,
  degraded: boolean,
  lastRead: number,
  now: number,
  staleAfterMs: number,
): BoardFreshness {
  if (degraded) return 'stale';
  if (!live) return 'fixtures';
  return now - lastRead > staleAfterMs ? 'stale' : 'live';
}
