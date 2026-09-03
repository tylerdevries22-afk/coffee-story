/**
 * How long a delegated access grant stays on the table after it stops
 * authorizing anything.
 *
 * A grant may authorize for at most 30 days (the table's own CHECK), but until
 * the sweeper landed nothing ended a row: an expired grant sat there forever,
 * naming a brand, a network, a scope and whoever issued it. It is kept for a
 * while on purpose -- "who lent what to whom, and when did it end" is the
 * question an access review asks -- and 90 days matches the window raw
 * analytics events are held for, so the platform has one answer rather than two.
 */
export const DELEGATED_GRANT_RETENTION_DAYS = 90;

/** The `ended_before` cutoff for one hosted maintenance tick. */
export function delegatedGrantRetentionCutoff(now: Date): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - DELEGATED_GRANT_RETENTION_DAYS);
  return cutoff.toISOString();
}
