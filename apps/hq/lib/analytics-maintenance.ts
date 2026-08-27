export type AnalyticsMaintenanceCutoffs = Readonly<{
  rebuildFrom: string;
  rawBefore: string;
  hourlyBefore: string;
  dailyBefore: string;
}>;

/** Returns the hosted analytics rollup and retention windows for one cron tick. */
export function analyticsMaintenanceCutoffs(now: Date): AnalyticsMaintenanceCutoffs {
  const rebuildFrom = new Date(now.getTime() - 48 * 60 * 60 * 1_000);
  const rawBefore = new Date(now);
  rawBefore.setUTCDate(rawBefore.getUTCDate() - 90);
  const aggregateBefore = new Date(now);
  aggregateBefore.setUTCMonth(aggregateBefore.getUTCMonth() - 25);
  return Object.freeze({
    rebuildFrom: rebuildFrom.toISOString(),
    rawBefore: rawBefore.toISOString(),
    hourlyBefore: aggregateBefore.toISOString(),
    dailyBefore: aggregateBefore.toISOString().slice(0, 10),
  });
}
