import Link from 'next/link';

import type { KpiTotals } from '@/lib/kpi';
import { formatMoney, formatShare } from '@/lib/kpi';

type LocationRollup = KpiTotals & { readonly locationId: string; readonly locationName: string };

export function DashboardLocationTable({ rows }: { readonly rows: readonly LocationRollup[] }) {
  return (
    <section className="hq-panel hq-location-panel" aria-labelledby="location-performance-title">
      <header className="hq-panel-header">
        <div>
          <p className="hq-eyebrow">Store performance</p>
          <h2 id="location-performance-title">Location comparison</h2>
          <p>Ranked by net reported revenue for the selected period.</p>
        </div>
        <Link href="/locations">Manage locations</Link>
      </header>
      {rows.length > 0 ? (
        <div className="hq-table-region" role="region" aria-label="Location performance table" tabIndex={0}>
          <table>
            <thead>
              <tr><th>Location</th><th>Revenue</th><th>Orders</th><th>Average order</th><th>Owned share</th><th>Loyalty</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.locationId}>
                  <td><span className="hq-location-rank">{index + 1}</span><strong>{row.locationName}</strong></td>
                  <td>{formatMoney(row.revenueCents)}</td>
                  <td>{row.ordersCount.toLocaleString('en-US')}</td>
                  <td>{formatMoney(row.aovCents)}</td>
                  <td>{formatShare(row.inAppShare)}</td>
                  <td>{formatShare(row.loyaltyRedemptionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="hq-table-empty">
          <strong>No location metrics yet</strong>
          <p>Connect a location and complete orders to populate the reporting layer.</p>
          <Link href="/locations">Review location setup</Link>
        </div>
      )}
    </section>
  );
}
