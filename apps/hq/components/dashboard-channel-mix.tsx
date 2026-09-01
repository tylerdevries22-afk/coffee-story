import Link from 'next/link';

import type { ChannelMixRow } from '@/lib/dashboard-overview';
import { formatMoney, formatShare } from '@/lib/kpi';

export function DashboardChannelMix({ channels }: { readonly channels: readonly ChannelMixRow[] }) {
  return (
    <section className="hq-panel hq-channel-panel" aria-labelledby="channel-mix-title">
      <header className="hq-panel-header">
        <div>
          <p className="hq-eyebrow">Revenue mix</p>
          <h2 id="channel-mix-title">Where orders are closing</h2>
          <p>Owned and in-store channels across the selected workspace.</p>
        </div>
        <Link href="/analytics/commerce">Commerce analytics</Link>
      </header>
      <div className="hq-channel-bars" role="img" aria-label="Revenue share by order channel">
        {channels.map((channel) => (
          <div className="hq-channel-row" key={channel.key}>
            <div><span>{channel.label}</span><strong>{formatMoney(channel.revenueCents)}</strong></div>
            <div className="hq-channel-track" aria-hidden="true">
              <span style={{ width: `${channel.share * 100}%` }} />
            </div>
            <small>{formatShare(channel.share)}</small>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Revenue by order channel</caption>
        <thead><tr><th>Channel</th><th>Revenue</th><th>Share</th></tr></thead>
        <tbody>
          {channels.map((channel) => (
            <tr key={channel.key}>
              <td>{channel.label}</td><td>{formatMoney(channel.revenueCents)}</td><td>{formatShare(channel.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
