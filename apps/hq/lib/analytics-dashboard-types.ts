import type {
  CampaignSummary,
  CustomerSummary,
  DropSummary,
  KpiDay,
} from './demo-data';
import type { AnalyticsRollup } from './analytics-rollups';

export type AnalyticsViewKey =
  | 'overview'
  | 'apps'
  | 'commerce'
  | 'operations'
  | 'training'
  | 'growth'
  | 'reliability';

export type AnalyticsMetric = {
  label: string;
  value: string;
  detail: string;
  state: 'available' | 'collecting';
};

export type AnalyticsTable = {
  title: string;
  description: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  emptyMessage: string;
};

export type AnalyticsBreakdownRow = {
  label: string;
  value: number;
  formattedValue: string;
};

export type AnalyticsDashboardModel = {
  eyebrow: string;
  title: string;
  description: string;
  sourceNote: string;
  metrics: readonly AnalyticsMetric[];
  breakdown?: {
    title: string;
    description: string;
    rows: readonly AnalyticsBreakdownRow[];
  };
  tables: readonly AnalyticsTable[];
  collecting: readonly string[];
};

export type AnalyticsDashboardInput = {
  kpis: readonly KpiDay[];
  drops: readonly DropSummary[];
  campaigns: readonly CampaignSummary[];
  customers: readonly CustomerSummary[];
  telemetry?: readonly AnalyticsRollup[];
};
