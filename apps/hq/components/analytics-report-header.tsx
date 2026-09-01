import Link from 'next/link';

import type { AnalyticsDashboardModel } from '@/lib/analytics-dashboard';
import type { AnalyticsReport } from '@/lib/analytics-report';

import { Icon } from './icon';

type AnalyticsReportHeaderProps = {
  model: AnalyticsDashboardModel;
  report: AnalyticsReport;
  locationLabel: string;
};

export function AnalyticsReportHeader({ model, report, locationLabel }: AnalyticsReportHeaderProps) {
  return (
    <header className="analytics-report-header">
      <div className="analytics-report-heading">
        <p>{model.eyebrow}</p>
        <h1>{model.title}</h1>
        <span>{model.description}</span>
      </div>
      <div className="analytics-report-actions" aria-label="Report scope and actions">
        <span className="analytics-scope-chip">{locationLabel}</span>
        <span className="analytics-date-chip">{report.rangeLabel}</span>
        <Link className="analytics-export-button" href="/analytics/export">
          <Icon name="upload" size={16} /> Export CSV
        </Link>
      </div>
    </header>
  );
}
