import { buildCsv } from '@/lib/csv';
import { loadKpis } from '@/lib/data';

/** GET /analytics/export — the store-vs-store dataset as a CSV download. */
export async function GET(): Promise<Response> {
  const rows = await loadKpis();
  const csv = buildCsv(
    ['day', 'location', 'orders', 'revenue_cents', 'app_revenue_cents', 'web_revenue_cents', 'kiosk_revenue_cents', 'pos_revenue_cents', 'aov_cents', 'in_app_share', 'loyalty_redemption_rate'],
    rows.map((row) => [
      row.day,
      row.locationName,
      row.ordersCount,
      row.revenueCents,
      row.channelRevenueCents.app,
      row.channelRevenueCents.web,
      row.channelRevenueCents.kiosk,
      row.channelRevenueCents.pos,
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
