import { isRevenueOrderStatus } from '@platform/schema';

import type { CampaignSummary, CustomerSummary, DeviceSummary, FeeRow } from './demo-data';

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
    if (!order.customer_id || !isRevenueOrderStatus(order.status)) continue;
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

export type DeviceRowLike = {
  id: string;
  location_id: string;
  role: string;
  label: string;
  paired_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  refresh_secret_hash: string | null;
  refresh_secret_issued_at: string | null;
  refresh_secret_last_used_at: string | null;
};

/**
 * Reduces the device columns to the one thing an operator needs to read off a
 * list: whether this screen will still be working tomorrow.
 *
 * Order matters. Revoked wins over everything, because a revoked row keeps its
 * pairing timestamps and would otherwise read as healthy. Unpaired comes next,
 * since a device with no paired_at has never run. Only then does the credential
 * distinguish "durable" from "expiring" -- and expiring is the default rather
 * than the exception, because a screen holding nothing but a twelve-hour token
 * is the state this whole feature exists to get rid of.
 *
 * refresh_secret_hash is read as a boolean and never rendered. Any staff
 * account can select it brand-wide, so its value must not reach a page.
 */
export function deviceSummariesOf(
  rows: DeviceRowLike[], locationNames: ReadonlyMap<string, string>,
): DeviceSummary[] {
  return rows.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    locationName: locationNames.get(row.location_id) ?? 'Unknown location',
    role: (['kiosk', 'pos', 'display', 'prep'] as const).find((role) => role === row.role) ?? 'prep',
    label: row.label || 'Unlabelled',
    health: row.revoked_at !== null
      ? 'revoked'
      : row.paired_at === null
        ? 'unpaired'
        : row.refresh_secret_hash !== null ? 'durable' : 'expiring',
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    secretIssuedAt: row.refresh_secret_issued_at,
    secretLastUsedAt: row.refresh_secret_last_used_at,
  }));
}
