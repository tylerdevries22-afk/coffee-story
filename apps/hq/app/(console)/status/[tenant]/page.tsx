import { loadTenantStatus } from '@/lib/status-data';
import { overallSummary, stateLabel, stateTone } from '@/lib/status-report';

export const dynamic = 'force-dynamic';

/**
 * The public per-tenant status page: /status/<slug>.
 *
 * Every signal on it is measured at request time under the publishable key, so
 * RLS is still the boundary and nothing here reads as the service role. What
 * cannot be measured says so rather than showing green, and an unknown slug
 * gets a page that explains itself instead of a blank frame.
 */
export default async function StatusPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const status = await loadTenantStatus(tenant);

  if (!status.tenantName) {
    return (
      <>
        <h1>Service status</h1>
        <p className="subtitle">No tenant on this platform answers to that name.</p>
        <section className="card">
          <h2>Nothing to report</h2>
          <p className="status-note">
            Check the address, or open the status page from the console, which always links
            to the tenant you are signed in to.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <h1>{status.tenantName} — service status</h1>
      <p className="subtitle">{overallSummary(status.overall)}</p>
      <p className="status-headline">
        <span className={`pill ${stateTone(status.overall)}`.trim()}>{stateLabel(status.overall)}</span>
        <time dateTime={status.observedAt}>Checked {status.observedAt}</time>
      </p>

      <section aria-labelledby="status-dependencies">
        <h2 id="status-dependencies" className="status-section-title">Dependencies</h2>
        <ul className="status-list">
          {status.reports.map((report) => (
            <li className="card status-row" key={report.key}>
              <div className="status-row-copy">
                <h3>{report.name}</h3>
                <p className="status-note">{report.detail}</p>
              </div>
              <span className={`pill ${stateTone(report.state)}`.trim()}>{stateLabel(report.state)}</span>
              <p className="status-note status-row-note">{report.note}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="status-incidents">
        <h2 id="status-incidents" className="status-section-title">Incidents</h2>
        {status.incidents.length === 0 ? (
          <p className="status-note">
            {status.probed
              ? 'No incident is open against a checked dependency.'
              : 'This deployment runs no dependency checks, so no incident can be reported here.'}
          </p>
        ) : (
          <ul className="status-list">
            {status.incidents.map((incident) => (
              <li className="card notice danger" key={incident.key}>
                <h3>{incident.title}</h3>
                <p className="status-note">{incident.impact}</p>
                <p className="status-note">
                  Observed <time dateTime={incident.observedAt}>{incident.observedAt}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="status-note status-footnote">Schema release {status.schemaRelease}</p>
    </>
  );
}
