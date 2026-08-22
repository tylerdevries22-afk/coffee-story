/**
 * Row -> page-shape mappers for the live data layer. Pure — no next/headers,
 * no Supabase client — so `node:test` reaches every mapping the console
 * renders. lib/data.ts feeds these real rows; the shapes are the fixtures',
 * which is what lets each page change one import and nothing else.
 */
import type {
  CampaignSummary,
  CustomerSummary,
  DropSummary,
  FeeRow,
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
};

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

export type CampaignRowLike = {
  id: string;
  name: string;
  channel: CampaignSummary['channel'];
  status: CampaignSummary['status'];
  scheduled_at: string | null;
  audience: unknown;
  stats: unknown;
};

export function campaignSummariesOf(rows: CampaignRowLike[]): CampaignSummary[] {
  return rows.map((row) => {
    const audience = (row.audience ?? {}) as { kind?: string; days?: number; min_points?: number };
    const stats = (row.stats ?? {}) as { sent?: number; delivered?: number; redeemed?: number };
    const audienceLabel = audience.kind === 'lapsed'
      ? `Lapsed ${audience.days ?? 30} days`
      : audience.kind === 'loyalty_tier'
        ? `${(audience.min_points ?? 0).toLocaleString('en-US')}+ points`
        : 'Everyone';
    return {
      id: row.id,
      name: row.name,
      channel: row.channel,
      status: row.status,
      scheduledAt: row.scheduled_at,
      audience: audienceLabel,
      sent: Number(stats.sent ?? stats.delivered ?? 0),
      redeemed: Number(stats.redeemed ?? 0),
    };
  });
}

export type CustomerRowLike = {
  id: string;
  full_name: string;
  phone: string | null;
};

export type CustomerOrderRow = {
  customer_id: string | null;
  total_cents: number;
  status: string;
  created_at: string;
};

export type PointsRow = { customer_id: string; points_balance: number | string };

export function customerSummariesOf(
  customers: CustomerRowLike[],
  points: PointsRow[],
  orders: CustomerOrderRow[],
): CustomerSummary[] {
  const pointsByCustomer = new Map(points.map((row) => [row.customer_id, Number(row.points_balance)]));
  const lifetime = new Map<string, number>();
  const lastOrder = new Map<string, string>();
  for (const order of orders) {
    if (!order.customer_id || order.status === 'cancelled' || order.status === 'refunded') continue;
    lifetime.set(order.customer_id, (lifetime.get(order.customer_id) ?? 0) + order.total_cents);
    const seen = lastOrder.get(order.customer_id);
    if (!seen || order.created_at > seen) lastOrder.set(order.customer_id, order.created_at);
  }
  return customers.map((customer) => ({
    id: customer.id,
    name: customer.full_name || 'Guest',
    phone: customer.phone ?? '—',
    points: pointsByCustomer.get(customer.id) ?? 0,
    lifetimeCents: lifetime.get(customer.id) ?? 0,
    lastOrderAt: lastOrder.get(customer.id) ?? '',
  }));
}

export type PlatformFeeRowLike = {
  location_id: string;
  gross_cents: number;
  fee_cents: number;
  created_at: string;
};

/** One row per calendar month x location, newest month first — the fees page's shape. */
export function feeRowsOf(
  rows: PlatformFeeRowLike[],
  locationNames: ReadonlyMap<string, string>,
): FeeRow[] {
  const grouped = new Map<string, FeeRow>();
  for (const row of rows) {
    const month = row.created_at.slice(0, 7);
    const key = `${month}|${row.location_id}`;
    const entry = grouped.get(key) ?? {
      month,
      locationId: row.location_id,
      locationName: locationNames.get(row.location_id) ?? 'Location',
      grossCents: 0,
      feeCents: 0,
      payments: 0,
    };
    entry.grossCents += row.gross_cents;
    entry.feeCents += row.fee_cents;
    entry.payments += 1;
    grouped.set(key, entry);
  }
  return [...grouped.values()].sort((a, b) => b.month.localeCompare(a.month) || a.locationName.localeCompare(b.locationName));
}
