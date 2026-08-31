import { AnalyticsDashboard } from '@/components/analytics-dashboard';
import { buildAnalyticsDashboard, type AnalyticsViewKey } from '@/lib/analytics-dashboard';
import { loadAnalyticsRollups } from '@/lib/analytics-rollups';
import { loadCampaigns, loadCustomers, loadDrops, loadKpis } from '@/lib/data';
import { selectedLocationLabel } from '@/lib/workspace-location';

type AnalyticsRouteProps = {
  view: AnalyticsViewKey;
};

/** Load tenant-scoped operational facts and render one analytics view. */
export async function AnalyticsRoute({ view }: AnalyticsRouteProps) {
  try {
    const [kpis, drops, campaigns, customers, telemetry, locationLabel] = await Promise.all([
      loadKpis(),
      loadDrops(),
      loadCampaigns(),
      loadCustomers(),
      loadAnalyticsRollups(),
      selectedLocationLabel(),
    ]);

    const model = buildAnalyticsDashboard(view, { kpis, drops, campaigns, customers, telemetry });
    return <AnalyticsDashboard model={model} locationLabel={locationLabel} />;
  } catch {
    return (
      <section className="analytics-load-error" role="alert">
        <p className="analytics-eyebrow">Analytics unavailable</p>
        <h1>We couldn&rsquo;t load this reporting view</h1>
        <p>The current tenant&rsquo;s operational data could not be read. No cached or cross-tenant values were substituted.</p>
        <a className="button secondary" href="">Try again</a>
      </section>
    );
  }
}
