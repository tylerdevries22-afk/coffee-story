import Link from 'next/link';

import type { DemoSiteSummary } from '@/lib/demo-factory/console-data';

function day(value: string | null): string {
  return value ? value.slice(0, 10) : '—';
}

/**
 * The demos most recently built, and whether each prospect has looked. The
 * open count is the outreach loop's only signal, so a preview from here goes
 * through the console rather than the prospect's link, and does not count.
 * Screens viewed and last viewed are the same: they come from the demo-
 * runtime's own in-app capture (20260918150000), never from a console preview.
 */
export function DemoRecentSites({ sites }: { sites: readonly DemoSiteSummary[] }) {
  return (
    <section className="card">
      <h2>Recent demos</h2>
      {sites.length === 0 ? (
        <p className="factory-muted">No demos built yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Business</th><th>State</th><th className="num">Opens</th><th>Last opened</th>
              <th className="num">Screens viewed</th><th>Last viewed</th><th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => (
              <tr key={site.id}>
                <td><Link href={`/demos/${site.id}`}>{site.businessName}</Link></td>
                <td>{site.state}</td>
                <td className="num">{site.openCount}</td>
                <td>{day(site.lastOpenedAt)}</td>
                <td className="num">{site.screenViews}</td>
                <td>{day(site.lastViewedAt)}</td>
                <td>{day(site.expiresAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
