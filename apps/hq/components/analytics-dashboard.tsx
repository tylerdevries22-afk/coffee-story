import Link from 'next/link';

import type { AnalyticsDashboardModel } from '@/lib/analytics-dashboard';

type AnalyticsDashboardProps = {
  model: AnalyticsDashboardModel;
};

function MetricCard({ metric }: { metric: AnalyticsDashboardModel['metrics'][number] }) {
  return (
    <article className={`analytics-metric ${metric.state}`}>
      <div className="analytics-metric-label">
        <span>{metric.label}</span>
        <span className="analytics-metric-state" aria-label={metric.state === 'available' ? 'Available' : 'Collecting data'}>
          {metric.state === 'available' ? 'Live' : 'Pending'}
        </span>
      </div>
      <strong>{metric.value}</strong>
      <p>{metric.detail}</p>
    </article>
  );
}

function Breakdown({ breakdown }: { breakdown: NonNullable<AnalyticsDashboardModel['breakdown']> }) {
  const maximum = Math.max(1, ...breakdown.rows.map((row) => row.value));

  return (
    <section className="analytics-panel" aria-labelledby="analytics-breakdown-title">
      <div className="analytics-panel-heading">
        <div>
          <h2 id="analytics-breakdown-title">{breakdown.title}</h2>
          <p>{breakdown.description}</p>
        </div>
      </div>
      <div className="analytics-bars" aria-hidden="true">
        {breakdown.rows.map((row) => (
          <div className="analytics-bar-row" key={row.label}>
            <div className="analytics-bar-meta">
              <span>{row.label}</span>
              <strong>{row.formattedValue}</strong>
            </div>
            <div className="analytics-bar-track">
              <span style={{ width: `${Math.max(2, (row.value / maximum) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="analytics-chart-note">The matching values are available in the table below.</p>
    </section>
  );
}

function DataTable({ table }: { table: AnalyticsDashboardModel['tables'][number] }) {
  return (
    <section className="analytics-panel analytics-table-panel" aria-labelledby={`analytics-table-${table.title.replaceAll(' ', '-').toLowerCase()}`}>
      <div className="analytics-panel-heading">
        <div>
          <h2 id={`analytics-table-${table.title.replaceAll(' ', '-').toLowerCase()}`}>{table.title}</h2>
          <p>{table.description}</p>
        </div>
        <span className="analytics-record-count">{table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'}</span>
      </div>
      {table.rows.length === 0 ? (
        <div className="analytics-empty">
          <span aria-hidden="true">···</span>
          <strong>Collecting the first complete window</strong>
          <p>{table.emptyMessage}</p>
        </div>
      ) : (
        <div className="analytics-table-scroll" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {table.columns.map((column) => <th key={column} scope="col">{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={`${row[0] ?? 'row'}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    cellIndex === 0
                      ? <th className="analytics-row-heading" key={`${cell}-${cellIndex}`} scope="row">{cell}</th>
                      : <td key={`${cell}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Shared, read-only analytics presentation for every contextual analytics view. */
export function AnalyticsDashboard({ model }: AnalyticsDashboardProps) {
  return (
    <div className="analytics-page">
      <header className="analytics-heading">
        <div>
          <p className="analytics-eyebrow">{model.eyebrow}</p>
          <h1>{model.title}</h1>
          <p className="subtitle">{model.description}</p>
        </div>
        <div className="analytics-actions" aria-label="Report actions">
          <span className="analytics-filter-chip">Last 7 days</span>
          <span className="analytics-filter-chip">All locations</span>
          <Link className="button secondary" href="/analytics/export">Export CSV</Link>
        </div>
      </header>

      <aside className="analytics-source-note">
        <span aria-hidden="true">i</span>
        <p>{model.sourceNote}</p>
      </aside>

      <section className="analytics-metric-grid" aria-label="Key metrics">
        {model.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </section>

      {model.breakdown ? <Breakdown breakdown={model.breakdown} /> : null}

      {model.collecting.length > 0 ? (
        <section className="analytics-collection-panel" aria-labelledby="analytics-collection-title">
          <div>
            <span className="analytics-pulse" aria-hidden="true" />
            <div>
              <h2 id="analytics-collection-title">Collection in progress</h2>
              <p>Unavailable values stay blank until verified records complete a reporting window.</p>
            </div>
          </div>
          <ul>
            {model.collecting.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}

      <div className="analytics-table-stack">
        {model.tables.map((table) => <DataTable key={table.title} table={table} />)}
      </div>
    </div>
  );
}
