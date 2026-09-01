import type { AnalyticsDashboardModel } from '@/lib/analytics-dashboard';
import type { AnalyticsReport } from '@/lib/analytics-report';

import { AnalyticsReportHeader } from './analytics-report-header';
import { AnalyticsResultsTable } from './analytics-results-table';
import { AnalyticsSignalPanel } from './analytics-signal-panel';
import { AnalyticsTrendPanel } from './analytics-trend-panel';

type AnalyticsDashboardProps = {
  model: AnalyticsDashboardModel;
  report: AnalyticsReport;
  locationLabel: string;
};

/** Shared, read-only analytics presentation for every contextual analytics view. */
export function AnalyticsDashboard({ model, report, locationLabel }: AnalyticsDashboardProps) {
  return (
    <div className="analytics-page">
      <AnalyticsReportHeader model={model} report={report} locationLabel={locationLabel} />
      <div className="analytics-overview-grid">
        <AnalyticsTrendPanel report={report} primaryMetric={model.metrics[0]} />
        <AnalyticsSignalPanel metrics={model.metrics} sourceNote={model.sourceNote} collecting={model.collecting} />
      </div>
      <AnalyticsResultsTable tables={model.tables} />
    </div>
  );
}
