/** KPI aggregation for the dashboard. Pure and tested; integer cents. */
import type { KpiDay } from './demo-data';

export type KpiTotals = {
  revenueCents: number;
  ordersCount: number;
  aovCents: number;
  inAppShare: number;
  loyaltyRedemptionRate: number;
};

/** Revenue-weighted rollup across locations and days. */
export function rollupKpis(days: readonly KpiDay[]): KpiTotals {
  const revenueCents = days.reduce((sum, day) => sum + day.revenueCents, 0);
  const ordersCount = days.reduce((sum, day) => sum + day.ordersCount, 0);
  const weighted = (pick: (day: KpiDay) => number, weight: (day: KpiDay) => number) => {
    const total = days.reduce((sum, day) => sum + weight(day), 0);
    if (total === 0) return 0;
    return days.reduce((sum, day) => sum + pick(day) * weight(day), 0) / total;
  };
  return {
    revenueCents,
    ordersCount,
    aovCents: ordersCount === 0 ? 0 : Math.round(revenueCents / ordersCount),
    inAppShare: weighted((day) => day.inAppShare, (day) => day.revenueCents),
    loyaltyRedemptionRate: weighted((day) => day.loyaltyRedemptionRate, (day) => day.ordersCount),
  };
}

/** Per-location rollups, ordered by revenue, for store-vs-store views. */
export function rollupByLocation(days: readonly KpiDay[]): (KpiTotals & { locationId: string; locationName: string })[] {
  const byLocation = new Map<string, KpiDay[]>();
  for (const day of days) {
    const bucket = byLocation.get(day.locationId) ?? [];
    bucket.push(day);
    byLocation.set(day.locationId, bucket);
  }
  return [...byLocation.entries()]
    .map(([locationId, bucket]) => ({
      locationId,
      locationName: bucket[0]?.locationName ?? locationId,
      ...rollupKpis(bucket),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
}

export function formatMoney(cents: number): string {
  const dollars = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100).toString().padStart(2, '0');
  return `$${dollars.toLocaleString('en-US')}.${remainder}`;
}

export function formatShare(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
