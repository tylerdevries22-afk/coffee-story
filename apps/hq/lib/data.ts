/**
 * The console's data layer: every page asks here and cannot tell where the
 * answer came from. Unconfigured deployments (previews, `next build`, local
 * work with no env) get the demo fixtures; configured ones read real rows
 * under the signed-in user's RLS — the 0008 metric views for KPIs, the
 * tables for everything else. Each page changed exactly one import to move
 * from fixtures to this.
 */
import {
  DEMO_CAMPAIGNS,
  DEMO_CUSTOMERS,
  DEMO_DROPS,
  DEMO_FEES,
  DEMO_KPIS,
  DEMO_LOCATIONS,
  DEMO_MENU,
  type CampaignSummary,
  type CustomerSummary,
  type DropSummary,
  type FeeRow,
  type KpiDay,
  type LocationSummary,
  type MenuItemSummary,
} from './demo-data';
import {
  campaignSummariesOf,
  customerSummariesOf,
  dropSummariesOf,
  feeRowsOf,
  kpiDaysOf,
  locationSummariesOf,
  menuSummariesOf,
  type CampaignRowLike,
  type CustomerOrderRow,
  type CustomerRowLike,
  type DropPerformanceRow,
  type DropRowLike,
  type LocationRowLike,
  type MenuItemRowLike,
  type MetricsRow,
  type PlatformFeeRowLike,
  type PointsRow,
} from './live-mappers';
import { serverClient } from './supabase-server';

function sevenDaysAgo(): string {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return date.toISOString().slice(0, 10);
}

async function locationNames(): Promise<ReadonlyMap<string, string>> {
  const client = await serverClient();
  if (!client) return new Map();
  const rows = await client.from('locations').select('id, name').returns<{ id: string; name: string }[]>();
  if (rows.error) throw new Error(`locations: ${rows.error.message}`);
  return new Map((rows.data ?? []).map((row) => [row.id, row.name]));
}

export async function loadKpis(): Promise<KpiDay[]> {
  const client = await serverClient();
  if (!client) return DEMO_KPIS;
  const [metrics, names] = await Promise.all([
    client
      .from('location_daily_metrics')
      .select('location_id, day, orders_count, revenue_cents, aov_cents, in_app_share, loyalty_redemption_rate')
      .gte('day', sevenDaysAgo())
      .order('day')
      .returns<MetricsRow[]>(),
    locationNames(),
  ]);
  if (metrics.error) throw new Error(`location_daily_metrics: ${metrics.error.message}`);
  return kpiDaysOf(metrics.data ?? [], names);
}

export async function loadDrops(): Promise<DropSummary[]> {
  const client = await serverClient();
  if (!client) return DEMO_DROPS;
  const [drops, performance, items] = await Promise.all([
    client
      .from('drops')
      .select('id, item_id, starts_at, ends_at, status')
      .order('starts_at', { ascending: false })
      .returns<DropRowLike[]>(),
    client
      .from('drop_performance')
      .select('drop_id, orders_count, revenue_cents')
      .returns<DropPerformanceRow[]>(),
    client.from('menu_items').select('id, name').returns<{ id: string; name: string }[]>(),
  ]);
  if (drops.error) throw new Error(`drops: ${drops.error.message}`);
  if (performance.error) throw new Error(`drop_performance: ${performance.error.message}`);
  if (items.error) throw new Error(`menu_items: ${items.error.message}`);
  return dropSummariesOf(
    drops.data ?? [],
    performance.data ?? [],
    new Map((items.data ?? []).map((item) => [item.id, item.name])),
  );
}

export async function loadMenu(): Promise<MenuItemSummary[]> {
  const client = await serverClient();
  if (!client) return DEMO_MENU;
  const [items, categories] = await Promise.all([
    client
      .from('menu_items')
      .select('id, name, category_id, base_price_cents, sizes, modifiers, is_86d, image_url')
      .order('sort_order')
      .returns<MenuItemRowLike[]>(),
    client.from('menu_categories').select('id, title').returns<{ id: string; title: string }[]>(),
  ]);
  if (items.error) throw new Error(`menu_items: ${items.error.message}`);
  if (categories.error) throw new Error(`menu_categories: ${categories.error.message}`);
  return menuSummariesOf(
    items.data ?? [],
    new Map((categories.data ?? []).map((category) => [category.id, category.title])),
  );
}

export async function loadLocations(): Promise<LocationSummary[]> {
  const client = await serverClient();
  if (!client) return DEMO_LOCATIONS;
  const rows = await client
    .from('locations')
    .select('id, name, address, timezone, square_connection_id, ordering_paused, hours')
    .order('created_at')
    .returns<LocationRowLike[]>();
  if (rows.error) throw new Error(`locations: ${rows.error.message}`);
  return locationSummariesOf(rows.data ?? []);
}

export async function loadCampaigns(): Promise<CampaignSummary[]> {
  const client = await serverClient();
  if (!client) return DEMO_CAMPAIGNS;
  const rows = await client
    .from('campaigns')
    .select('id, name, channel, status, scheduled_at, audience, stats')
    .order('created_at', { ascending: false })
    .returns<CampaignRowLike[]>();
  if (rows.error) throw new Error(`campaigns: ${rows.error.message}`);
  return campaignSummariesOf(rows.data ?? []);
}

export async function loadCustomers(): Promise<CustomerSummary[]> {
  const client = await serverClient();
  if (!client) return DEMO_CUSTOMERS;
  // RLS already narrows what this role may see (managers brand-wide, shift
  // staff only guests with orders at their locations).
  const [customers, points, orders] = await Promise.all([
    client
      .from('customers')
      .select('id, full_name, phone')
      .order('created_at', { ascending: false })
      .limit(200)
      .returns<CustomerRowLike[]>(),
    client.from('loyalty_accounts').select('customer_id, points_balance').returns<PointsRow[]>(),
    client
      .from('orders')
      .select('customer_id, total_cents, status, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)
      .returns<CustomerOrderRow[]>(),
  ]);
  if (customers.error) throw new Error(`customers: ${customers.error.message}`);
  if (points.error) throw new Error(`loyalty_accounts: ${points.error.message}`);
  if (orders.error) throw new Error(`orders: ${orders.error.message}`);
  return customerSummariesOf(customers.data ?? [], points.data ?? [], orders.data ?? []);
}

export async function loadFees(): Promise<FeeRow[]> {
  const client = await serverClient();
  if (!client) return DEMO_FEES;
  const [rows, names] = await Promise.all([
    client
      .from('platform_fees')
      .select('location_id, gross_cents, fee_cents, created_at')
      .order('created_at', { ascending: false })
      .limit(5000)
      .returns<PlatformFeeRowLike[]>(),
    locationNames(),
  ]);
  if (rows.error) throw new Error(`platform_fees: ${rows.error.message}`);
  return feeRowsOf(rows.data ?? [], names);
}
