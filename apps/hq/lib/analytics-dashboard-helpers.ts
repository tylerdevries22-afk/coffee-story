import { formatMoney, formatShare, rollupByLocation, rollupKpis } from './kpi';
import type { AnalyticsDashboardInput, AnalyticsBreakdownRow, AnalyticsMetric, AnalyticsTable } from './analytics-dashboard-types';

export const collectingMetric = (label: string, detail: string): AnalyticsMetric => ({
  label,
  value: 'Collecting',
  detail,
  state: 'collecting',
});

export const number = (value: number): string => value.toLocaleString('en-US');

export const percentage = (numerator: number, denominator: number): string =>
  denominator === 0 ? '—' : formatShare(numerator / denominator);

export const moneyBreakdown = (input: AnalyticsDashboardInput): readonly AnalyticsBreakdownRow[] => {
  const channels = rollupKpis(input.kpis).channelRevenueCents;
  return [
    { label: 'Customer app', value: channels.app, formattedValue: formatMoney(channels.app) },
    { label: 'Web', value: channels.web, formattedValue: formatMoney(channels.web) },
    { label: 'Kiosk', value: channels.kiosk, formattedValue: formatMoney(channels.kiosk) },
    { label: 'Point of sale', value: channels.pos, formattedValue: formatMoney(channels.pos) },
  ];
};

export const locationTable = (input: AnalyticsDashboardInput): AnalyticsTable => ({
  title: 'Location comparison',
  description: 'Authoritative commerce totals for the current seven-day reporting window.',
  columns: ['Location', 'Revenue', 'Orders', 'AOV', 'App share', 'Loyalty use'],
  rows: rollupByLocation(input.kpis).map((row) => [
    row.locationName,
    formatMoney(row.revenueCents),
    number(row.ordersCount),
    formatMoney(row.aovCents),
    formatShare(row.inAppShare),
    formatShare(row.loyaltyRedemptionRate),
  ]),
  emptyMessage: 'No location activity is available for this reporting window.',
});

export const commerceTable = (input: AnalyticsDashboardInput): AnalyticsTable => ({
  title: 'Revenue by channel',
  description: 'The same values shown in the visual distribution, provided as an accessible table.',
  columns: ['Channel', 'Revenue'],
  rows: moneyBreakdown(input).map((row) => [row.label, row.formattedValue]),
  emptyMessage: 'No channel revenue is available for this reporting window.',
});

export const dropTable = (input: AnalyticsDashboardInput): AnalyticsTable => ({
  title: 'Drop performance',
  description: 'Sales attributable to each limited-time menu drop.',
  columns: ['Drop', 'Status', 'Orders', 'Revenue'],
  rows: input.drops.map((drop) => [
    drop.title,
    drop.status,
    number(drop.ordersCount),
    formatMoney(drop.revenueCents),
  ]),
  emptyMessage: 'No drops have been published yet.',
});

export const campaignTable = (input: AnalyticsDashboardInput): AnalyticsTable => ({
  title: 'Campaign performance',
  description: 'Delivery and redemption from the current tenant campaign records.',
  columns: ['Campaign', 'Channel', 'Status', 'Sent', 'Redeemed', 'Redemption rate'],
  rows: input.campaigns.map((campaign) => [
    campaign.name,
    campaign.channel,
    campaign.status,
    number(campaign.sent),
    number(campaign.redeemed),
    percentage(campaign.redeemed, campaign.sent),
  ]),
  emptyMessage: 'No campaigns have been created yet.',
});

const surfaceLabels = {
  customer: 'Customer', operator: 'Operator', kiosk: 'Kiosk', display: 'Location display', hq: 'HQ',
} as const;

export function telemetryCount(input: AnalyticsDashboardInput, metricKey: string): number {
  return (input.telemetry ?? []).filter((row) => row.metricKey === metricKey)
    .reduce((sum, row) => sum + row.eventCount, 0);
}

export function latestP95(input: AnalyticsDashboardInput, metricKey: string): number | null {
  const value = (input.telemetry ?? []).find((row) => row.metricKey === metricKey)?.durationP95Ms;
  return value ?? null;
}

export const surfaceTable = (input: AnalyticsDashboardInput): AnalyticsTable => ({
  title: 'Surface readiness',
  description: 'Behavioral telemetry appears here after each deployed surface sends consent-safe events.',
  columns: ['Surface', 'Sessions', 'Completion', 'Performance', 'State'],
  rows: (Object.keys(surfaceLabels) as readonly (keyof typeof surfaceLabels)[]).map((surface) => {
    const rows = (input.telemetry ?? []).filter((row) => row.surface === surface);
    const sessions = rows.filter((row) => row.metricKey === 'session.started')
      .reduce((sum, row) => sum + row.eventCount, 0);
    const latestReady = rows.find((row) => row.metricKey === 'screen.ready')?.durationP95Ms;
    return [surfaceLabels[surface], sessions ? number(sessions) : '—', '—', latestReady === null || latestReady === undefined ? '—' : `${number(latestReady)} ms`, rows.length ? 'Reporting' : 'Collecting'];
  }),
  emptyMessage: 'No surfaces are configured for this tenant.',
});

export const collectingTable = (title: string, description: string, firstColumn: string): AnalyticsTable => ({
  title,
  description,
  columns: [firstColumn, 'Current', 'Previous', 'Change', 'State'],
  rows: [],
  emptyMessage: 'Consent-safe events are being collected. Results will appear when the first complete window is available.',
});
