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
  DEMO_DEVICES,
  DEMO_DROPS,
  DEMO_FEES,
  DEMO_KPIS,
  DEMO_SESSION,
  DEMO_MENU,
  type CampaignSummary,
  type CustomerSummary,
  type DeviceSummary,
  type DropSummary,
  type FeeRow,
  type KpiDay,
  type LocationSummary,
  type MenuItemSummary,
  DEMO_KIOSK_FLOW,
  DEMO_KIOSK_MENU,
} from './demo-data';
import {
  campaignSummariesOf,
  customerSummariesOf,
  deviceSummariesOf,
  dropSummariesOf,
  feeRowsOf,
  kpiDaysOf,
  locationSummariesOf,
  menuSummariesOf,
  type CampaignRowLike,
  type CustomerOrderRow,
  type CustomerRowLike,
  type DeviceRowLike,
  type DropPerformanceRow,
  type DropRowLike,
  type LocationRowLike,
  type MenuItemRowLike,
  type MetricsRow,
  type PlatformFeeRowLike,
  type PointsRow,
} from './live-mappers';
import type { KioskMenuFacts } from '@platform/domain';

import { serverClient } from './supabase-server';
import { selectedLocationId, selectedOrgId } from './workspace-location';
import { scopeRowsToLocation } from './location-scope';
import { demoLocationsFor } from './demo-locations';

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
  const locationId = await selectedLocationId();
  const client = await serverClient();
  if (!client) return scopeRowsToLocation(DEMO_KPIS, locationId);
  // The header location scopes the query itself when set, so the database
  // returns only that store's days rather than filtering after the read.
  const base = client
    .from('location_daily_metrics')
    .select('location_id, day, orders_count, revenue_cents, aov_cents, in_app_share, loyalty_redemption_rate, revenue_by_channel')
    .gte('day', sevenDaysAgo())
    .order('day');
  const [metrics, names] = await Promise.all([
    (locationId ? base.eq('location_id', locationId) : base).returns<MetricsRow[]>(),
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

/**
 * Whether the selected brand may run more than one location. Gates the
 * "add location" affordance: a single-location brand has the flag off, so the
 * console does not invite a second store it is not licensed for. Demo brands
 * default to enabled so the wizard is reachable with no database.
 */
export async function loadMultiLocationEnabled(): Promise<boolean> {
  const client = await serverClient();
  if (!client) return true;
  const orgId = (await selectedOrgId()) ?? DEMO_SESSION.brandId;
  const row = await client.from('brands').select('multi_location').eq('id', orgId)
    .maybeSingle<{ multi_location: boolean }>();
  return row.error ? false : row.data?.multi_location === true;
}

export async function loadLocations(): Promise<LocationSummary[]> {
  const client = await serverClient();
  if (!client) {
    // Demo: the selected org's stores from the in-memory store, so a location
    // added through the wizard shows up here for the rest of the session.
    const orgId = (await selectedOrgId()) ?? DEMO_SESSION.brandId;
    return demoLocationsFor(orgId);
  }
  // `square_connection_id` is NOT selected: 0040 revokes it from
  // `authenticated` at column level, and this client is the signed-in user, so
  // naming it here makes the whole query fail with "permission denied for
  // column". Whether a location can take a card comes from the view built for
  // it -- `location_square_status` is a security-barrier view over
  // square_connections, filtered by `app.is_brand_staff`, and only its WRITES
  // were revoked.
  const [rows, square] = await Promise.all([
    client
      .from('locations')
      .select('id, name, address, timezone, ordering_paused, hours')
      .order('created_at')
      .returns<Omit<LocationRowLike, 'square_connection_id'>[]>(),
    client
      .from('location_square_status')
      .select('location_id')
      .returns<{ location_id: string }[]>(),
  ]);
  if (rows.error) throw new Error(`locations: ${rows.error.message}`);
  if (square.error) throw new Error(`location_square_status: ${square.error.message}`);

  const connected = new Set((square.data ?? []).map((row) => row.location_id));
  return locationSummariesOf(
    (rows.data ?? []).map((row) => ({
      ...row,
      square_connection_id: connected.has(row.id) ? row.id : null,
    })),
  );
}

/**
 * Every screen in the brand, newest first.
 *
 * Deliberately brand-wide rather than filtered to the caller's locations:
 * `devices_select` already admits any staff account brand-wide, so filtering
 * here would hide rows without protecting them, and an operator who cannot see
 * the display at the other store cannot tell you it has stopped. What is
 * location-scoped is doing something to one -- that check lives in
 * lib/device-admin and runs on every write.
 */
export async function loadDevices(): Promise<DeviceSummary[]> {
  const client = await serverClient();
  if (!client) return DEMO_DEVICES;
  const [rows, names] = await Promise.all([
    client
      .from('devices')
      .select('id, location_id, role, label, paired_at, revoked_at, last_seen_at, '
        + 'refresh_secret_hash, refresh_secret_issued_at, refresh_secret_last_used_at')
      .order('created_at', { ascending: false })
      .returns<DeviceRowLike[]>(),
    locationNames(),
  ]);
  if (rows.error) throw new Error(`devices: ${rows.error.message}`);
  return deviceSummariesOf(rows.data ?? [], names);
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
  const locationId = await selectedLocationId();
  const client = await serverClient();
  if (!client) return scopeRowsToLocation(DEMO_FEES, locationId);
  const base = client
    .from('platform_fees')
    .select('location_id, gross_cents, fee_cents, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);
  const [rows, names] = await Promise.all([
    (locationId ? base.eq('location_id', locationId) : base).returns<PlatformFeeRowLike[]>(),
    locationNames(),
  ]);
  if (rows.error) throw new Error(`platform_fees: ${rows.error.message}`);
  return feeRowsOf(rows.data ?? [], names);
}


export type KioskConfigView = {
  /** The raw `brand_config.kiosk`, or null when the brand has none. */
  kiosk: unknown;
  /** What the resolver needs to tell a live tile from a dead one. */
  menu: KioskMenuFacts;
  /** For optimistic concurrency on save; null when unknown. */
  updatedAt: string | null;
};

export type BrandConfigView = {
  config: unknown;
  updatedAt: string | null;
};

/** Current settings and row version for the concurrency-safe brand editor. */
export async function loadBrandConfig(): Promise<BrandConfigView> {
  const client = await serverClient();
  if (!client) return { config: null, updatedAt: null };
  const result = await client.from('brands').select('brand_config, updated_at').maybeSingle<{
    brand_config: unknown;
    updated_at: string;
  }>();
  if (result.error) throw new Error(`brands: ${result.error.message}`);
  return { config: result.data?.brand_config ?? null, updatedAt: result.data?.updated_at ?? null };
}

/**
 * The kiosk flow, plus enough of the menu to validate it against.
 *
 * The menu is loaded because `resolveKioskFlow` drops a tile pointing at a
 * category that no longer exists -- the most likely way this config goes wrong,
 * and completely invisible to any check that only reads the config. Categories
 * are keyed by TITLE because `menu_categories` (0003) has no slug and a uuid
 * differs per environment, so a title is the only thing a tenant file can name
 * a category by.
 */
export async function loadKioskConfig(): Promise<KioskConfigView> {
  const client = await serverClient();
  if (!client) return { kiosk: DEMO_KIOSK_FLOW, menu: DEMO_KIOSK_MENU, updatedAt: null };

  const brand = await client.from('brands').select('id, brand_config, updated_at').maybeSingle<{
    id: string;
    brand_config: Record<string, unknown> | null;
    updated_at: string;
  }>();
  if (brand.error) throw new Error(`brands: ${brand.error.message}`);
  const brandRow = brand.data;
  const brandId = brandRow?.id;
  if (!brandId) throw new Error('brands: no tenant in scope');
  const publishedMenu = await client.from('menus').select('id').eq('brand_id', brandId)
    .eq('is_published', true).maybeSingle<{ id: string }>();
  if (publishedMenu.error) throw new Error(`menus: ${publishedMenu.error.message}`);
  const menuId = publishedMenu.data?.id;
  const [categories, items] = await Promise.all([
    client.from('menu_categories').select('title').eq('brand_id', brandId).eq('menu_id', menuId ?? '').returns<{ title: string }[]>(),
    client.from('menu_items').select('slug, image_url').eq('brand_id', brandId).eq('menu_id', menuId ?? '').returns<{ slug: string; image_url: string | null }[]>(),
  ]);
  if (categories.error) throw new Error(`menu_categories: ${categories.error.message}`);
  if (items.error) throw new Error(`menu_items: ${items.error.message}`);

  return {
    kiosk: brandRow.brand_config?.kiosk ?? null,
    menu: {
      categories: (categories.data ?? []).map((row) => ({ id: row.title, title: row.title })),
      itemSlugs: (items.data ?? []).map((row) => row.slug),
      ...(() => {
        const imageUrls = Object.fromEntries(
          (items.data ?? []).filter((row) => row.image_url).map((row) => [row.slug, row.image_url as string]),
        );
        return Object.keys(imageUrls).length > 0 ? { imageUrls } : {};
      })(),
    },
    updatedAt: brandRow.updated_at ?? null,
  };
}
