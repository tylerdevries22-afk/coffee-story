/**
 * Row -> page-shape mappers for the live data layer. Pure — no next/headers,
 * no Supabase client — so `node:test` reaches every mapping the console
 * renders. lib/data.ts feeds these real rows; the shapes are the fixtures',
 * which is what lets each page change one import and nothing else.
 */
import type {
  DropSummary,
  KpiDay,
  LocationSummary,
  MenuItemSummary,
} from './demo-data';

export type MetricsRow = {
  location_id: string;
  day: string;
  orders_count: number | string;
  revenue_cents: number | string;
  aov_cents: number | string;
  in_app_share: number | string;
  loyalty_redemption_rate: number | string;
  revenue_by_channel: unknown;
};

function channelRevenueOf(value: unknown): KpiDay['channelRevenueCents'] {
  const row = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const cents = (channel: string) => {
    const amount = Number(row[channel] ?? 0);
    return Number.isFinite(amount) && amount >= 0 ? amount : 0;
  };
  return { app: cents('app'), web: cents('web'), kiosk: cents('kiosk'), pos: cents('pos') };
}

export function kpiDaysOf(rows: MetricsRow[], locationNames: ReadonlyMap<string, string>): KpiDay[] {
  return rows.map((row) => ({
    day: row.day,
    locationId: row.location_id,
    locationName: locationNames.get(row.location_id) ?? 'Location',
    ordersCount: Number(row.orders_count),
    revenueCents: Number(row.revenue_cents),
    aovCents: Number(row.aov_cents),
    inAppShare: Number(row.in_app_share),
    loyaltyRedemptionRate: Number(row.loyalty_redemption_rate),
    channelRevenueCents: channelRevenueOf(row.revenue_by_channel),
  }));
}

export type DropRowLike = {
  id: string;
  item_id: string;
  starts_at: string;
  ends_at: string;
  status: DropSummary['status'];
};

export type DropPerformanceRow = {
  drop_id: string;
  orders_count: number | string;
  revenue_cents: number | string;
};

export function dropSummariesOf(
  drops: DropRowLike[],
  performance: DropPerformanceRow[],
  itemNames: ReadonlyMap<string, string>,
): DropSummary[] {
  const byDrop = new Map(performance.map((row) => [row.drop_id, row]));
  return drops.map((drop) => {
    const itemName = itemNames.get(drop.item_id) ?? 'Menu item';
    const perf = byDrop.get(drop.id);
    return {
      id: drop.id,
      title: itemName,
      itemName,
      startsAt: drop.starts_at,
      endsAt: drop.ends_at,
      status: drop.status,
      ordersCount: Number(perf?.orders_count ?? 0),
      revenueCents: Number(perf?.revenue_cents ?? 0),
    };
  });
}

export type MenuItemRowLike = {
  id: string;
  name: string;
  category_id: string;
  base_price_cents: number;
  sizes: unknown;
  modifiers: unknown;
  is_86d: boolean;
  image_url: string | null;
};

export function menuSummariesOf(
  items: MenuItemRowLike[],
  categoryTitles: ReadonlyMap<string, string>,
): MenuItemSummary[] {
  return items.map((item) => {
    const sizes = Array.isArray(item.sizes) ? item.sizes as { price_cents?: number }[] : [];
    const fromCents = sizes.length > 0
      ? Math.min(...sizes.map((size) => size.price_cents ?? item.base_price_cents))
      : item.base_price_cents;
    return {
      id: item.id,
      name: item.name,
      category: categoryTitles.get(item.category_id) ?? 'Menu',
      priceCents: fromCents,
      is86d: item.is_86d,
      modifierGroups: Array.isArray(item.modifiers) ? item.modifiers.length : 0,
      imageUrl: item.image_url,
    };
  });
}

export type LocationRowLike = {
  id: string;
  name: string;
  address: unknown;
  timezone: string;
  square_connection_id: string | null;
  ordering_paused: boolean;
  hours: unknown;
};

export function locationSummariesOf(rows: LocationRowLike[]): LocationSummary[] {
  return rows.map((row) => {
    const address = (row.address ?? {}) as { city?: string; region?: string };
    const hourEntries = Object.entries((row.hours ?? {}) as Record<string, unknown>)
      .filter(([, windows]) => Array.isArray(windows) && windows.length > 0);
    return {
      id: row.id,
      name: row.name,
      city: [address.city, address.region].filter(Boolean).join(', ') || '—',
      timezone: row.timezone,
      squareConnected: row.square_connection_id !== null,
      orderingPaused: row.ordering_paused,
      hours: hourEntries.length > 0 ? `${hourEntries.length} days configured` : 'Not set',
    };
  });
}
