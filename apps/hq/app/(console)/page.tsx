import { DashboardActionCenter, type DashboardAction } from '@/components/dashboard-action-center';
import { DashboardChannelMix } from '@/components/dashboard-channel-mix';
import { DashboardHeader } from '@/components/dashboard-header';
import { DashboardLocationTable } from '@/components/dashboard-location-table';
import { DashboardMetrics, type DashboardMetric } from '@/components/dashboard-metrics';
import { currentSession, hasRole } from '@/lib/auth';
import { loadDrops, loadKpis } from '@/lib/data';
import { buildChannelMix, coverageDays, formatKpiRange } from '@/lib/dashboard-overview';
import { demoSyncRuntimeEnabled } from '@/lib/demo-sync-http';
import { formatMoney, formatShare, rollupByLocation, rollupKpis } from '@/lib/kpi';
import { selectedLocationLabel } from '@/lib/workspace-location';

import { DemoLiveActivity } from './demo-live-activity';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [kpis, drops, locationLabel, session] = await Promise.all([
    loadKpis(), loadDrops(), selectedLocationLabel(), currentSession(),
  ]);
  const totals = rollupKpis(kpis);
  const byLocation = rollupByLocation(kpis);
  const reportingDays = coverageDays(kpis);
  const canManageLocation = hasRole(session, 'location_manager');
  const canManageBrand = hasRole(session, 'brand_owner');
  const liveDrop = drops.find((drop) => drop.status === 'live');
  const metrics: DashboardMetric[] = [
    {
      label: 'Revenue', value: formatMoney(totals.revenueCents), icon: 'analytics',
      detail: byLocation.length === 0
        ? 'Awaiting location reporting'
        : `${byLocation.length} ${byLocation.length === 1 ? 'location' : 'locations'} reporting`,
    },
    {
      label: 'Orders', value: totals.ordersCount.toLocaleString('en-US'), icon: 'drop',
      detail: reportingDays === 0
        ? 'Awaiting completed orders'
        : `${Math.round(totals.ordersCount / reportingDays).toLocaleString('en-US')} per reporting day`,
    },
    {
      label: 'Average order', value: formatMoney(totals.aovCents), icon: 'menu',
      detail: 'Blended across every order channel',
    },
    {
      label: 'Owned-channel share', value: formatShare(totals.inAppShare), icon: 'campaign',
      detail: `${formatShare(totals.loyaltyRedemptionRate)} of orders redeem loyalty`,
    },
  ];
  const actions: DashboardAction[] = [
    { href: '/locations', label: 'Review locations', description: 'Square, ordering, and device readiness', icon: 'locations' },
    {
      href: canManageBrand ? '/catalog' : '/menu',
      label: canManageBrand ? 'Manage catalog' : 'Review menu',
      description: 'Products, pricing, images, and availability',
      icon: 'menu',
    },
    ...(canManageLocation ? [{
      href: '/operations', label: 'Open live operations',
      description: 'Active work, issues, and shift ownership', icon: 'wall' as const,
    }] : []),
    ...(canManageLocation ? [{
      href: '/analytics', label: 'Explore analytics',
      description: 'Commerce, growth, training, and reliability', icon: 'analytics' as const,
    }] : []),
  ];
  const primaryAction = canManageLocation
    ? { href: '/operations', label: 'Open live operations', icon: 'wall' as const }
    : { href: '/locations', label: 'Review locations', icon: 'locations' as const };

  return (
    <div className="hq-dashboard">
      <DashboardHeader
        locationLabel={locationLabel}
        rangeLabel={formatKpiRange(kpis)}
        action={primaryAction}
      />
      <DashboardMetrics metrics={metrics} />
      {demoSyncRuntimeEnabled() ? <DemoLiveActivity /> : null}
      <div className="hq-dashboard-grid">
        <DashboardChannelMix channels={buildChannelMix(totals.channelRevenueCents)} />
        <DashboardActionCenter actions={actions} liveDrop={liveDrop} />
      </div>
      <DashboardLocationTable rows={byLocation} />
    </div>
  );
}
