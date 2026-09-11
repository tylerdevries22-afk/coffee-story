import { DEMO_DROPS, DEMO_KPIS, DEMO_MENU, type DropSummary, type KpiDay, type MenuItemSummary } from './demo-data';
import {
  dropSummariesOf, kpiDaysOf, menuSummariesOf,
  type DropPerformanceRow, type DropRowLike, type MenuItemRowLike, type MetricsRow,
} from './live-mappers';
import { serverClient } from './supabase-server';
import { selectedLocationId } from './workspace-location';
import { scopeRowsToLocation } from './location-scope';
import { liveScope } from './live-scope';
import { demoFixture, locationNames, sevenDaysAgo } from './data-shared';

export async function loadKpis(): Promise<KpiDay[]> {
  const locationId = await selectedLocationId();
  const client = await serverClient();
  if (!client) return demoFixture(scopeRowsToLocation(DEMO_KPIS, locationId), []);
  const scope = await liveScope(client);
  if (!scope.orgId || scope.locationIds.length === 0) return [];
  // The header location scopes the query itself when set, so the database
  // returns only that store's days rather than filtering after the read.
  const base = client
    .from('location_daily_metrics')
    .select('location_id, day, orders_count, revenue_cents, aov_cents, in_app_share, loyalty_redemption_rate, revenue_by_channel')
    .gte('day', sevenDaysAgo())
    .order('day');
  const [metrics, names] = await Promise.all([
    (scope.locationId ? base.eq('location_id', scope.locationId) : base.in('location_id', [...scope.locationIds]))
      .eq('brand_id', scope.orgId).returns<MetricsRow[]>(),
    locationNames(client, scope.orgId),
  ]);
  if (metrics.error) throw new Error(`location_daily_metrics: ${metrics.error.message}`);
  return kpiDaysOf(metrics.data ?? [], names);
}

export async function loadDrops(): Promise<DropSummary[]> {
  const client = await serverClient();
  if (!client) return demoFixture(DEMO_DROPS, []);
  const scope = await liveScope(client);
  if (!scope.orgId) return [];
  const [drops, performance, items] = await Promise.all([
    client
      .from('drops')
      .select('id, item_id, starts_at, ends_at, status')
      .eq('brand_id', scope.orgId)
      .order('starts_at', { ascending: false })
      .returns<DropRowLike[]>(),
    client
      .from('drop_performance')
      .select('drop_id, orders_count, revenue_cents')
      .eq('brand_id', scope.orgId)
      .returns<DropPerformanceRow[]>(),
    client.from('menu_items').select('id, name').eq('brand_id', scope.orgId).returns<{ id: string; name: string }[]>(),
  ]);
  if (drops.error) throw new Error(`drops: ${drops.error.message}`);
  if (items.error) throw new Error(`menu_items: ${items.error.message}`);
  // Drop performance is an optional aggregate. A recently issued Supabase
  // token can be rejected by one read replica while the base rows are valid
  // (for example, during clock skew). Keep the dashboard usable with zeroed
  // performance rather than failing the entire Server Components render.
  return dropSummariesOf(
    drops.data ?? [],
    performance.error ? [] : performance.data ?? [],
    new Map((items.data ?? []).map((item) => [item.id, item.name])),
  );
}

export async function loadMenu(): Promise<MenuItemSummary[]> {
  const client = await serverClient();
  if (!client) return demoFixture(DEMO_MENU, []);
  const scope = await liveScope(client);
  if (!scope.orgId) return [];
  const [items, categories] = await Promise.all([
    client
      .from('menu_items')
      .select('id, name, category_id, base_price_cents, sizes, modifiers, is_86d, image_url')
      .eq('brand_id', scope.orgId)
      .order('sort_order')
      .returns<MenuItemRowLike[]>(),
    client.from('menu_categories').select('id, title').eq('brand_id', scope.orgId).returns<{ id: string; title: string }[]>(),
  ]);
  if (items.error) throw new Error(`menu_items: ${items.error.message}`);
  if (categories.error) throw new Error(`menu_categories: ${categories.error.message}`);
  return menuSummariesOf(
    items.data ?? [],
    new Map((categories.data ?? []).map((category) => [category.id, category.title])),
  );
}
