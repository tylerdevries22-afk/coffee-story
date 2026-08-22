import { DEMO_DROPS, DEMO_KPIS } from '@/lib/demo-data';
import { formatMoney, formatShare, rollupByLocation } from '@/lib/kpi';

export default function AnalyticsPage() {
  const byLocation = rollupByLocation(DEMO_KPIS);
  return (
    <>
      <h1>Analytics</h1>
      <p className="subtitle">Store vs store, drop performance, and retention. Export anything as CSV.</p>

      <div className="card">
        <h2>Store vs store — last 7 days</h2>
        <table>
          <thead>
            <tr><th>Location</th><th className="num">Revenue</th><th className="num">Orders</th><th className="num">AOV</th><th className="num">In-app share</th></tr>
          </thead>
          <tbody>
            {byLocation.map((row) => (
              <tr key={row.locationId}>
                <td>{row.locationName}</td>
                <td className="num">{formatMoney(row.revenueCents)}</td>
                <td className="num">{row.ordersCount.toLocaleString('en-US')}</td>
                <td className="num">{formatMoney(row.aovCents)}</td>
                <td className="num">{formatShare(row.inAppShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Drop performance</h2>
        <table>
          <thead>
            <tr><th>Drop</th><th>Status</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">Orders/day</th></tr>
          </thead>
          <tbody>
            {DEMO_DROPS.map((drop) => {
              const days = Math.max(1, Math.round((new Date(drop.endsAt).getTime() - new Date(drop.startsAt).getTime()) / 86_400_000));
              return (
                <tr key={drop.id}>
                  <td>{drop.title}</td>
                  <td>{drop.status}</td>
                  <td className="num">{drop.ordersCount.toLocaleString('en-US')}</td>
                  <td className="num">{formatMoney(drop.revenueCents)}</td>
                  <td className="num">{Math.round(drop.ordersCount / days).toLocaleString('en-US')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Cohort retention</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          Monthly signup cohorts by reorder rate land here once order history
          accrues in the schema&rsquo;s orders table — the view exists; the chart
          needs real months of data to mean anything.
        </p>
      </div>

      <a className="button" href="/analytics/export">Export CSV</a>
    </>
  );
}
