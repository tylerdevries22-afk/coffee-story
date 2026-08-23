/**
 * The live PortalBundle: real rows read straight from Supabase under RLS,
 * shaped into the same bundle the demo plane feeds the screens — the seam
 * auth-context already branches on `isDemo`, so no screen changes shape.
 *
 * Domains the live schema does not serve yet (messages, intake, membership,
 * payment methods, gift cards) are left ABSENT rather than faked; the
 * screens hide their entry points when the key is undefined.
 */
import {
  fetchBrandBySlug,
  fetchCustomerByUser,
  fetchCustomerOrders,
  fetchLoyaltySummary,
  upsertOwnCustomer,
  type BrandSummary,
} from '@platform/data';
import type { OrderRow } from '@platform/schema';
import type { SupabaseClient } from '@supabase/supabase-js';

import { TENANT } from '@/tenant';
import type {
  PortalBundle,
  PortalOrder,
  PortalOrderLine,
  RewardCatalogItem,
  RewardEntry,
} from '@/types/domain';

/** The brand row changes on deploys, not per guest; one fetch per app run. */
let brandPromise: Promise<BrandSummary | null> | null = null;

export function liveBrand(client: SupabaseClient): Promise<BrandSummary | null> {
  brandPromise ??= fetchBrandBySlug(client, TENANT.identity.slug).catch((error: unknown) => {
    brandPromise = null;
    throw error;
  });
  return brandPromise;
}

/** Where an order goes: the tenant's first location (single-location brands). */
export async function liveOrderContext(
  client: SupabaseClient,
): Promise<{ brandId: string; locationId: string } | null> {
  const brand = await liveBrand(client);
  const location = brand?.locations[0];
  if (!brand || !location) return null;
  return { brandId: brand.brand.id, locationId: location.id };
}

type SnapshotLine = {
  name?: string;
  quantity?: number;
  unit_price_cents?: number;
  options?: string[];
};

function portalOrderOf(row: OrderRow): PortalOrder {
  const totals = (row.totals ?? {}) as { lines?: SnapshotLine[] };
  const lines: PortalOrderLine[] = (totals.lines ?? []).map((line) => ({
    name: line.name ?? 'Item',
    quantity: line.quantity ?? 1,
    unitPriceCents: line.unit_price_cents ?? 0,
    options: line.options ?? [],
  }));
  const summary = lines
    .map((line) => (line.quantity > 1 ? `${line.quantity}× ${line.name}` : line.name))
    .join(', ');
  return {
    id: row.id,
    status: row.status,
    summary: summary || 'Order',
    lines,
    fulfillmentType: row.fulfillment_type,
    scheduledFor: row.scheduled_for,
    placedAt: row.created_at,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    tipCents: row.tip_cents,
    totalCents: row.total_cents,
    note: row.note,
  };
}

/** brand_config.loyalty.rewards → the rewards screen's catalog shape. */
export function rewardCatalogOf(brandConfig: unknown): RewardCatalogItem[] {
  const raw = (brandConfig as { loyalty?: { rewards?: unknown } } | null)?.loyalty?.rewards;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const reward = entry as { slug?: unknown; name?: unknown; points_cost?: unknown };
    if (typeof reward.slug !== 'string' || typeof reward.name !== 'string' || typeof reward.points_cost !== 'number') {
      return [];
    }
    return [{ id: reward.slug, name: reward.name, description: null, pointsCost: reward.points_cost, active: true }];
  });
}

const LEDGER_TYPES: Record<string, RewardEntry['entryType']> = {
  earn: 'purchase',
  redeem: 'redemption',
  adjust: 'adjustment',
  reverse: 'adjustment',
};

export async function loadLivePortal(
  client: SupabaseClient,
  user: { id: string; email: string | null; fullName: string },
): Promise<PortalBundle> {
  const brand = await liveBrand(client);
  if (!brand) {
    throw new Error('This shop is not set up yet. Try again shortly.');
  }
  // First contact creates the guest's own row under RLS, so the bundle (and
  // everything keyed off profile.id) exists from the first sign-in.
  const customer = (await fetchCustomerByUser(client, user.id))
    ?? (await upsertOwnCustomer(client, {
      brandId: brand.brand.id,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
    }));

  const [orders, loyalty] = await Promise.all([
    fetchCustomerOrders(client, customer.id),
    fetchLoyaltySummary(client, customer.id),
  ]);

  return {
    profile: {
      id: customer.id,
      fullName: customer.full_name,
      email: customer.email ?? user.email ?? '',
      phone: customer.phone,
      birthday: null,
      avatarUrl: null,
    },
    role: 'client',
    orders: [...orders.active, ...orders.past].map(portalOrderOf),
    rewardAccount: {
      availablePoints: loyalty.account?.points_balance ?? 0,
      annualPoints: loyalty.account?.lifetime_points ?? 0,
      cashCents: loyalty.storedValueBalanceCents,
      annualPeriodStart: `${new Date().getFullYear()}-01-01`,
    },
    rewardLedger: loyalty.ledger.map((event) => ({
      id: event.id,
      entryType: LEDGER_TYPES[event.type] ?? 'adjustment',
      points: event.points,
      description: event.note || (event.type === 'earn' ? 'Order' : event.type),
      earnedAt: event.created_at,
      expiresAt: null,
    })),
    rewardActivities: [],
    rewardCatalog: rewardCatalogOf(brand.brand.brand_config),
    giftCards: [],
    // messages / intake / membership / paymentMethods stay absent: the live
    // schema has no rows behind them yet, and their screens hide accordingly.
  };
}
