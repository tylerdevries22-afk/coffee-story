import { buildCsv } from '@/lib/csv';
import { loadKpis } from '@/lib/data';

/**
 * GET /analytics/export — the store-vs-store dataset as a CSV download.
 *
 * This imported DEMO_KPIS directly, so a configured deployment handed a brand
 * owner a file of invented revenue for two fictitious Denver locations, named
 * as their own. `loadKpis` is what the page beside this button already reads,
 * and it falls back to the fixtures only when there is no Supabase to read.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const rows = await loadKpis();
  const csv = buildCsv(
    ['day', 'location', 'orders', 'revenue_cents', 'aov_cents', 'in_app_share', 'loyalty_redemption_rate'],
    rows.map((row) => [
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
