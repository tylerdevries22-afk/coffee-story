import { buildCsv } from '@/lib/csv';
import { DEMO_KPIS } from '@/lib/demo-data';

/** GET /analytics/export — the store-vs-store dataset as a CSV download. */
export function GET(): Response {
  const csv = buildCsv(
    ['day', 'location', 'orders', 'revenue_cents', 'aov_cents', 'in_app_share', 'loyalty_redemption_rate'],
    DEMO_KPIS.map((row) => [
      row.day,
      row.locationName,
      row.ordersCount,
      row.revenueCents,
      row.aovCents,
      row.inAppShare.toFixed(4),
      row.loyaltyRedemptionRate.toFixed(4),
    ]),
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="location-daily-metrics.csv"',
    },
  });
}
