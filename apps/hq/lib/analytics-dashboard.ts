import { formatMoney, formatShare, rollupByLocation, rollupKpis } from './kpi';
import {
  campaignTable, collectingMetric, collectingTable, commerceTable, dropTable,
  latestP95, locationTable, moneyBreakdown, number, percentage, surfaceTable, telemetryCount,
} from './analytics-dashboard-helpers';
import type { AnalyticsDashboardInput, AnalyticsDashboardModel, AnalyticsViewKey } from './analytics-dashboard-types';

export type * from './analytics-dashboard-types';

/** Build a deterministic analytics view from tenant-scoped operational records. */
export function buildAnalyticsDashboard(
  view: AnalyticsViewKey,
  input: AnalyticsDashboardInput,
): AnalyticsDashboardModel {
  const totals = rollupKpis(input.kpis);
  const sent = input.campaigns.reduce((sum, campaign) => sum + campaign.sent, 0);
  const redeemed = input.campaigns.reduce((sum, campaign) => sum + campaign.redeemed, 0);
  const customerValue = input.customers.reduce((sum, customer) => sum + customer.lifetimeCents, 0);
  const liveDrops = input.drops.filter((drop) => drop.status === 'live').length;
  const sessions = telemetryCount(input, 'session.started');
  const errors = telemetryCount(input, 'error.occurred');
  const screenReadyP95 = latestP95(input, 'screen.ready');

  switch (view) {
    case 'overview':
      return {
        eyebrow: 'Decision center',
        title: 'Analytics overview',
        description: 'A current view of commerce and location performance, with behavioral signals added only after consent-safe collection.',
        sourceNote: 'Commerce metrics come from authoritative order records. Behavioral metrics are never inferred.',
        metrics: [
          { label: 'Revenue', value: formatMoney(totals.revenueCents), detail: 'Last 7 days', state: 'available' },
          { label: 'Orders', value: number(totals.ordersCount), detail: 'Completed order records', state: 'available' },
          { label: 'Average order', value: formatMoney(totals.aovCents), detail: 'Revenue per order', state: 'available' },
          { label: 'App revenue share', value: formatShare(totals.inAppShare), detail: 'Customer app channel', state: 'available' },
          sessions ? { label: 'Sessions', value: number(sessions), detail: 'Consent-safe 30-day events', state: 'available' } : collectingMetric('Sessions', 'Awaiting consent-safe sessions'),
          collectingMetric('Connector health', 'Awaiting connector snapshots'),
        ],
        breakdown: {
          title: 'Revenue distribution',
          description: 'Channel contribution for the current reporting window.',
          rows: moneyBreakdown(input),
        },
        tables: [locationTable(input), commerceTable(input)],
        collecting: ['Active and engaged users', 'Cross-app conversion', 'Connector health'],
      };
    case 'apps':
      return {
        eyebrow: 'Five-surface telemetry',
        title: 'App usage',
        description: 'Understand journeys across the customer, operator, kiosk, location display, and HQ experiences.',
        sourceNote: 'Only bounded, consent-permitted event properties are eligible for these views.',
        metrics: [
          sessions ? { label: 'Sessions', value: number(sessions), detail: 'Across all app surfaces', state: 'available' } : collectingMetric('Sessions', 'Across all app surfaces'),
          collectingMetric('Engaged users', 'Pseudonymous, consent-permitted'),
          collectingMetric('Flow completion', 'Tenant-configured journeys'),
          screenReadyP95 === null ? collectingMetric('Screen ready p95', 'Measured at each surface') : { label: 'Latest screen ready p95', value: `${number(screenReadyP95)} ms`, detail: 'Latest daily rollup', state: 'available' },
        ],
        tables: [surfaceTable(input), collectingTable('Most-used flows', 'Completion and abandonment by configured journey.', 'Flow')],
        collecting: ['Sessions by surface and version', 'Screen paths and task completion', 'Performance and error trends'],
      };
    case 'commerce':
      return {
        eyebrow: 'Authoritative order data',
        title: 'Commerce analytics',
        description: 'Compare revenue, order volume, channels, and limited-time product performance.',
        sourceNote: 'Revenue and order counts come from operational order aggregates, not client telemetry.',
        metrics: [
          { label: 'Revenue', value: formatMoney(totals.revenueCents), detail: 'Last 7 days', state: 'available' },
          { label: 'Orders', value: number(totals.ordersCount), detail: 'All active locations', state: 'available' },
          { label: 'Average order', value: formatMoney(totals.aovCents), detail: 'Revenue per order', state: 'available' },
          { label: 'Live drops', value: number(liveDrops), detail: `${number(input.drops.length)} total drops`, state: 'available' },
          collectingMetric('Checkout p95', 'Awaiting checkout timing events'),
          collectingMetric('Payment success', 'Awaiting payment outcome rollup'),
        ],
        breakdown: {
          title: 'Revenue by channel',
          description: 'Customer app, web, kiosk, and point-of-sale contribution.',
          rows: moneyBreakdown(input),
        },
        tables: [commerceTable(input), dropTable(input)],
        collecting: ['View-to-order funnel', 'Checkout duration and abandonment', 'Refund and repeat-purchase trends'],
      };
    case 'operations':
      return {
        eyebrow: 'Location execution',
        title: 'Operations analytics',
        description: 'Compare location throughput and prepare for queue, SLA, calendar, and realtime delivery reporting.',
        sourceNote: 'Current totals use operational records; timing metrics appear only when authoritative state transitions exist.',
        metrics: [
          { label: 'Orders processed', value: number(totals.ordersCount), detail: 'Last 7 days', state: 'available' },
          { label: 'Locations reporting', value: number(rollupByLocation(input.kpis).length), detail: 'With activity in range', state: 'available' },
          collectingMetric('Ready-time p95', 'Awaiting order state timings'),
          collectingMetric('Realtime delay', 'Awaiting propagation measurements'),
        ],
        tables: [locationTable(input), collectingTable('Service-level performance', 'Queue, preparation, handoff, and task completion.', 'Location')],
        collecting: ['Accepted-to-ready duration', 'SLA compliance', 'Task and calendar completion', 'Realtime propagation delay'],
      };
    case 'training':
      return {
        eyebrow: 'Workforce readiness',
        title: 'Training analytics',
        description: 'Track adoption and proficiency for the tenant’s published training release.',
        sourceNote: 'Training metrics remain blank until versioned progress records produce a complete reporting window.',
        metrics: [
          collectingMetric('Learners started', 'Current published release'),
          collectingMetric('Completion rate', 'Across required modules'),
          collectingMetric('Assessment pass rate', 'First and latest attempts'),
          collectingMetric('Time to proficiency', 'Role and location cohorts'),
        ],
        tables: [
          collectingTable('Track adoption', 'Knowledge, Skills, Service, Safety, Operations, and tenant modules.', 'Track'),
          collectingTable('Location readiness', 'Release adoption and completion by assigned location.', 'Location'),
        ],
        collecting: ['Starts and completions', 'Assessment outcomes', 'Release adoption', 'Role and location comparisons'],
      };
    case 'growth':
      return {
        eyebrow: 'Audience and retention',
        title: 'Growth analytics',
        description: 'Connect campaign delivery, redemptions, drops, and customer value without manufacturing attribution.',
        sourceNote: 'Campaign and customer totals are operational; acquisition and attribution await verified integration data.',
        metrics: [
          { label: 'Customers', value: number(input.customers.length), detail: 'Visible tenant records', state: 'available' },
          { label: 'Campaign sends', value: number(sent), detail: `${number(input.campaigns.length)} campaigns`, state: 'available' },
          { label: 'Redemption rate', value: percentage(redeemed, sent), detail: `${number(redeemed)} redemptions`, state: 'available' },
          { label: 'Customer value', value: formatMoney(customerValue), detail: 'Visible lifetime revenue', state: 'available' },
          collectingMetric('Retention', 'Awaiting complete cohorts'),
          collectingMetric('Attributed revenue', 'Awaiting verified connectors'),
        ],
        tables: [campaignTable(input), dropTable(input), collectingTable('Retention cohorts', 'Repeat behavior by first-order month.', 'Cohort')],
        collecting: ['Acquisition source', 'Retention cohorts', 'GA4, Ads, and Business Profile attribution'],
      };
    case 'reliability':
      return {
        eyebrow: 'Production health',
        title: 'Reliability analytics',
        description: 'Monitor errors, performance, stale clients, realtime delivery, and connector synchronization.',
        sourceNote: 'No health status is fabricated. Each metric requires deployed measurement or a provider health snapshot.',
        metrics: [
          errors ? { label: 'Recorded errors', value: number(errors), detail: 'Structured 30-day events', state: 'available' } : collectingMetric('Recorded errors', 'All deployed surfaces'),
          collectingMetric('API latency p95', 'Deployed route measurements'),
          collectingMetric('Realtime lag p95', 'Order and training propagation'),
          collectingMetric('Healthy connectors', 'Latest provider snapshots'),
        ],
        tables: [
          collectingTable('Surface health', 'Errors, versions, Web Vitals, and mobile readiness.', 'Surface'),
          collectingTable('Connector health', 'Sync latency, failures, and reauthorization state.', 'Connector'),
        ],
        collecting: ['Crash and error trends', 'LCP, INP, CLS, and mobile readiness', 'Stale client versions', 'Connector health and dead letters'],
      };
  }
}
