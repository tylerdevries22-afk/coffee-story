/** KPI aggregation for the dashboard. Pure and tested; integer cents. */
import type { ChannelRevenueCents, KpiDay } from './demo-data';

/**
 * Re-exported, not reimplemented. This module used to carry its own formatter
 * that always printed two decimals, so a whole-dollar total read `$26,124.00`
 * on the dashboard while the same amount read `$26,124` everywhere else on the
 * platform. One console, two spellings of one number.
 */
export { formatMoney } from '@platform/domain';

export type KpiTotals = {
  revenueCents: number;
  ordersCount: number;
  aovCents: number;
  inAppShare: number;
  loyaltyRedemptionRate: number;
  channelRevenueCents: ChannelRevenueCents;
};

/** Revenue-weighted rollup across locations and days. */
export function rollupKpis(days: readonly KpiDay[]): KpiTotals {
  const revenueCents = days.reduce((sum, day) => sum + day.revenueCents, 0);
  const ordersCount = days.reduce((sum, day) => sum + day.ordersCount, 0);
  const channelRevenueCents = days.reduce<ChannelRevenueCents>((total, day) => ({
    app: total.app + day.channelRevenueCents.app,
    web: total.web + day.channelRevenueCents.web,
    kiosk: total.kiosk + day.channelRevenueCents.kiosk,
    pos: total.pos + day.channelRevenueCents.pos,
  }), { app: 0, web: 0, kiosk: 0, pos: 0 });
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
    channelRevenueCents,
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

export function formatShare(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
