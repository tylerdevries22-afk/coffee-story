import { loadDrops } from '@/lib/data';
import { formatMoney } from '@/lib/kpi';
// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';


const STATUS_PILL: Record<string, string> = {
  live: 'pill success',
  scheduled: 'pill accent',
  ended: 'pill',
  draft: 'pill',
  cancelled: 'pill danger',
};

export default async function DropsPage() {
  const drops = await loadDrops();
  return (
    <>
      <h1>Drops</h1>
      <p className="subtitle">One limited run at a time. Scheduling a drop can draft its announcement campaign automatically.</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>Drop</th><th>Window</th><th>Status</th><th className="num">Orders</th><th className="num">Revenue</th></tr>
          </thead>
          <tbody>
            {drops.map((drop) => (
              <tr key={drop.id}>
                <td>
                  <strong>{drop.title}</strong>
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>{drop.itemName}</span>
                </td>
                <td>
                  {new Date(drop.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {new Date(drop.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
                <td><span className={STATUS_PILL[drop.status] ?? 'pill'}>{drop.status}</span></td>
                <td className="num">{drop.ordersCount.toLocaleString('en-US')}</td>
                <td className="num">{formatMoney(drop.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-2">
        <div className="card">
          <h2>Schedule a drop</h2>
          <label className="field">Item<input placeholder="Honey Lavender Latte" /></label>
          <label className="field">Starts<input type="datetime-local" /></label>
          <label className="field">Ends<input type="datetime-local" /></label>
          <label className="field">Hero image<input type="file" accept="image/*" /></label>
          <label className="field"><input type="checkbox" style={{ display: 'inline', width: 'auto' }} /> Draft the announcement campaign automatically</label>
          <button className="button" type="button">Schedule</button>
        </div>
        <div className="card">
          <h2>Countdown preview</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            The customer app renders the countdown chip from the drop window —
            &ldquo;Drops in 2d 4h&rdquo;, then &ldquo;Ends in 4h 12m&rdquo; — with the hero image
            full-bleed on Home.
          </p>
        </div>
      </div>
    </>
  );
}
