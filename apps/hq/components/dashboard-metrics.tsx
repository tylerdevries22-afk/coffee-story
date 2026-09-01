import type { IconName } from './icon';
import { Icon } from './icon';

export type DashboardMetric = {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly icon: IconName;
};

export function DashboardMetrics({ metrics }: { readonly metrics: readonly DashboardMetric[] }) {
  return (
    <section className="hq-metric-grid" aria-label="Performance at a glance">
      {metrics.map((metric) => (
        <article className="hq-metric-card" key={metric.label}>
          <div className="hq-metric-heading">
            <span>{metric.label}</span>
            <span className="hq-metric-icon"><Icon name={metric.icon} size={16} /></span>
          </div>
          <strong>{metric.value}</strong>
          <p>{metric.detail}</p>
        </article>
      ))}
    </section>
  );
}
