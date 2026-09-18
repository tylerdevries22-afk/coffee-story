/**
 * A bigint-or-string count from Postgres, normalized to a small safe integer.
 * Shared by console-data.ts and site-events.ts, split out here so neither has
 * to import the other just for this.
 */
export function count(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}
