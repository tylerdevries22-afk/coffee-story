import type { CSSProperties } from 'react';

import type { AnalyticsMetric } from '@/lib/analytics-dashboard';

type AnalyticsSignalPanelProps = {
  metrics: readonly AnalyticsMetric[];
  sourceNote: string;
  collecting: readonly string[];
};

function progressOf(metric: AnalyticsMetric): number {
  if (metric.state === 'collecting') return 0;
  const percentage = Number.parseFloat(metric.value.replace('%', ''));
  return metric.value.endsWith('%') && Number.isFinite(percentage)
    ? Math.min(100, Math.max(0, percentage))
    : 100;
}

function SignalRow({ metric }: { metric: AnalyticsMetric }) {
  const progress = progressOf(metric);
  const style = { '--analytics-progress': `${progress}%` } as CSSProperties;
  return (
    <li className={`analytics-signal-row is-${metric.state}`}>
      <div>
        <span className="analytics-signal-trend" aria-hidden="true">{metric.state === 'available' ? '↗' : '···'}</span>
        <strong>{metric.label}</strong>
        <span>{metric.value}</span>
      </div>
      <p>{metric.detail}</p>
      <div className="analytics-signal-track" role="progressbar" aria-label={`${metric.label}: ${metric.state === 'available' ? 'verified' : 'collecting'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} style={style}><i /></div>
    </li>
  );
}

export function AnalyticsSignalPanel({ metrics, sourceNote, collecting }: AnalyticsSignalPanelProps) {
  const headline = metrics.slice(0, 3);
  const signals = metrics.slice(3);
  return (
    <section className="analytics-card analytics-signal-panel" aria-labelledby="analytics-signal-title">
      <div className="analytics-card-heading">
        <h2 id="analytics-signal-title">Signal results</h2>
        <span>Verified sources</span>
      </div>
      <div className="analytics-signal-totals" aria-label="Headline metrics">
        {headline.map((metric) => <div key={metric.label} className={`is-${metric.state}`}><strong>{metric.value}</strong><span>{metric.label}</span></div>)}
      </div>
      {signals.length > 0 ? <ul className="analytics-signal-list">{signals.map((metric) => <SignalRow key={metric.label} metric={metric} />)}</ul> : null}
      <footer className="analytics-signal-footer">
        <p>{sourceNote}</p>
        {collecting.length > 0 ? <details><summary>{collecting.length} signals still collecting</summary><ul>{collecting.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      </footer>
    </section>
  );
}
