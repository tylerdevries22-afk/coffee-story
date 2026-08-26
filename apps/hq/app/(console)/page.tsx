import { loadDrops, loadKpis } from '@/lib/data';
import { formatMoney, formatShare, rollupByLocation, rollupKpis } from '@/lib/kpi';
import { demoSyncRuntimeEnabled } from '@/lib/demo-sync-http';
import { DemoLiveActivity } from './demo-live-activity';
// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';


export default async function DashboardPage() {
  const [kpis, drops] = await Promise.all([loadKpis(), loadDrops()]);
  const totals = rollupKpis(kpis);
  const byLocation = rollupByLocation(kpis);
  const liveDrop = drops.find((drop) => drop.status === 'live');
  return (
    <>
      <h1>This week</h1>
      <p className="subtitle">All locations · last 7 days</p>

      {demoSyncRuntimeEnabled() ? <DemoLiveActivity /> : null}

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Revenue</div>
          <div className="value">{formatMoney(totals.revenueCents)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Orders</div>
          <div className="value">{totals.ordersCount.toLocaleString('en-US')}</div>
        </div>
        <div className="kpi-card">
          <div className="label">In-app share</div>
          <div className="value">{formatShare(totals.inAppShare)}</div>
          <div className="hint">of revenue through your own channels</div>
        </div>
        <div className="kpi-card">
          <div className="label">Average order</div>
          <div className="value">{formatMoney(totals.aovCents)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Loyalty redemption</div>
          <div className="value">{formatShare(totals.loyaltyRedemptionRate)}</div>
          <div className="hint">orders redeeming points</div>
        </div>
      </div>

      <div className="card">
        <h2>Revenue by order channel</h2>
        <div className="kpi-row">
          <div className="kpi-card"><div className="label">App</div><div className="value">{formatMoney(totals.channelRevenueCents.app)}</div></div>
          <div className="kpi-card"><div className="label">Web</div><div className="value">{formatMoney(totals.channelRevenueCents.web)}</div></div>
          <div className="kpi-card"><div className="label">Kiosk</div><div className="value">{formatMoney(totals.channelRevenueCents.kiosk)}</div></div>
          <div className="kpi-card"><div className="label">POS</div><div className="value">{formatMoney(totals.channelRevenueCents.pos)}</div></div>
        </div>
      </div>

      {liveDrop ? (
        <div className="card">
          <h2>Live drop — {liveDrop.title}</h2>
          <table>
            <thead>
              <tr><th>Item</th><th>Ends</th><th className="num">Orders</th><th className="num">Revenue</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>{liveDrop.itemName}</td>
                <td>{new Date(liveDrop.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td className="num">{liveDrop.ordersCount.toLocaleString('en-US')}</td>
                <td className="num">{formatMoney(liveDrop.revenueCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card">
        <h2>By location</h2>
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th className="num">Revenue</th>
              <th className="num">Orders</th>
              <th className="num">AOV</th>
              <th className="num">In-app</th>
              <th className="num">Kiosk</th>
              <th className="num">POS</th>
              <th className="num">Loyalty</th>
            </tr>
          </thead>
          <tbody>
            {byLocation.map((row) => (
              <tr key={row.locationId}>
                <td>{row.locationName}</td>
                <td className="num">{formatMoney(row.revenueCents)}</td>
                <td className="num">{row.ordersCount.toLocaleString('en-US')}</td>
                <td className="num">{formatMoney(row.aovCents)}</td>
                <td className="num">{formatShare(row.inAppShare)}</td>
                <td className="num">{formatMoney(row.channelRevenueCents.kiosk)}</td>
                <td className="num">{formatMoney(row.channelRevenueCents.pos)}</td>
                <td className="num">{formatShare(row.loyaltyRedemptionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
