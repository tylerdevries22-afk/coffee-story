import type { AnalyticsRollup } from './analytics-rollups';
import type { AnalyticsViewKey } from './analytics-dashboard';
import type { KpiDay } from './demo-data';
import { formatMoney } from './kpi';

export type AnalyticsTrendPoint = Readonly<{
  day: string;
  label: string;
  value: number;
  formattedValue: string;
}>;

export type AnalyticsReport = Readonly<{
  rangeLabel: string;
  latestLabel: string;
  trendLabel: string;
  deltaLabel: string;
  direction: 'up' | 'down' | 'flat';
  points: readonly AnalyticsTrendPoint[];
}>;

type TrendDefinition = Readonly<{
  label: string;
  metricKey?: string;
  kpiValue?: (row: KpiDay) => number;
  format: (value: number) => string;
}>;

const compactNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, notation: 'compact' });
const dayLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const rangeDayLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function definitionOf(view: AnalyticsViewKey): TrendDefinition | null {
  switch (view) {
    case 'overview':
    case 'commerce':
      return { label: 'Daily revenue', kpiValue: (row) => row.revenueCents, format: formatMoney };
    case 'operations':
      return { label: 'Orders processed', kpiValue: (row) => row.ordersCount, format: compactNumber.format };
    case 'apps':
      return { label: 'Sessions', metricKey: 'session.started', format: compactNumber.format };
    case 'reliability':
      return { label: 'Recorded errors', metricKey: 'error.occurred', format: compactNumber.format };
    case 'growth':
    case 'training':
      return null;
  }
}

function groupedKpis(rows: readonly KpiDay[], definition: TrendDefinition): Map<string, number> {
  const grouped = new Map<string, number>();
  if (!definition.kpiValue) return grouped;
  for (const row of rows) grouped.set(row.day, (grouped.get(row.day) ?? 0) + definition.kpiValue(row));
  return grouped;
}

function groupedTelemetry(rows: readonly AnalyticsRollup[], definition: TrendDefinition): Map<string, number> {
  const grouped = new Map<string, number>();
  if (!definition.metricKey) return grouped;
  for (const row of rows) {
    if (row.metricKey === definition.metricKey) grouped.set(row.day, (grouped.get(row.day) ?? 0) + row.eventCount);
  }
  return grouped;
}

function deltaOf(points: readonly AnalyticsTrendPoint[]): Pick<AnalyticsReport, 'deltaLabel' | 'direction'> {
  const current = points.at(-1)?.value;
  const previous = points.at(-2)?.value;
  if (current === undefined || previous === undefined) return { deltaLabel: 'First verified point', direction: 'flat' };
  if (current === previous) return { deltaLabel: 'No daily change', direction: 'flat' };
  if (previous === 0) return { deltaLabel: 'New daily signal', direction: 'up' };
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return {
    deltaLabel: `${change > 0 ? '+' : ''}${change.toFixed(1)}% vs prior day`,
    direction: change > 0 ? 'up' : 'down',
  };
}

/** Builds an honest daily trend from the same tenant-scoped records as the report. */
export function analyticsReportOf(
  view: AnalyticsViewKey,
  kpis: readonly KpiDay[],
  telemetry: readonly AnalyticsRollup[],
): AnalyticsReport {
  const definition = definitionOf(view);
  if (!definition) return emptyReport(view === 'growth' ? 'Campaign activity' : 'Training progress');
  const grouped = definition.kpiValue ? groupedKpis(kpis, definition) : groupedTelemetry(telemetry, definition);
  const points = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, value]) => ({
    day,
    label: dayLabel.format(dateOf(day)),
    value,
    formattedValue: definition.format(value),
  }));
  if (points.length === 0) return emptyReport(definition.label);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return emptyReport(definition.label);
  return {
    rangeLabel: `${rangeDayLabel.format(dateOf(first.day))} – ${rangeDayLabel.format(dateOf(last.day))}`,
    latestLabel: `Latest verified ${last.label}`,
    trendLabel: definition.label,
    points,
    ...deltaOf(points),
  };
}

function emptyReport(trendLabel: string): AnalyticsReport {
  return {
    rangeLabel: 'No complete window',
    latestLabel: 'Collection in progress',
    trendLabel,
    deltaLabel: 'Awaiting verified events',
    direction: 'flat',
    points: [],
  };
}
