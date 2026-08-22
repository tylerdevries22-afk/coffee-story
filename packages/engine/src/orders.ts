/**
 * Order placement, tender-first.
 *
 * createOrder is the money path's front half: recompute every cent from
 * menu_items (the client only ever sends slugs), write the orders row with
 * its cart snapshot, append the created event, and — for tenders that settle
 * outside the platform (pay at pickup, external POS) — assert paid so the
 * order lands on the operator board. Idempotent on client_key: a retried
 * request returns the first order instead of ringing a guest up twice.
 *
 * captureSquarePayment is the back half for card tenders: Square order +
 * payment carrying app_fee_money, paid event, platform_fees row, loyalty
 * earn. Split from placement so a checkout that dies between the two never
 * strands money — the order just stays 'created' until capture succeeds or
 * the webhook advances it.
 *
 * Everything external is injected (service-role Supabase client, Square
 * config + the location's decrypted token), which keeps this testable and
 * keeps credentials at the edges.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { computeAppFeeCents, feeMonthKey, type FeeConfig } from './fees';
import { pointsEarnedFor } from './loyalty';
import { priceLine, MenuPricingError, type MenuItemPricing } from './menu-pricing';
import { taxCentsFor, taxRowsFor, type TaxJurisdiction } from './tax';
import {
  createSquareOrder,
  createSquarePayment,
  type SquareConfig,
  type SquareOrderLine,
} from './square/client';

export type OrderTenderType = 'pay_at_pickup' | 'external' | 'square_link' | 'square_card';

/** Tenders that settle off-platform: the order is committed the moment it is placed. */
const IMMEDIATE_TENDERS: ReadonlySet<OrderTenderType> = new Set(['pay_at_pickup', 'external']);

export class OrderError extends Error {
  readonly code:
    | 'invalid_request'
    | 'location_unknown'
    | 'ordering_paused'
    | 'item_unavailable'
    | MenuPricingError['code'];

  constructor(code: OrderError['code'], message: string) {
    super(message);
    this.name = 'OrderError';
    this.code = code;
  }
}

export type CreateOrderLine = {
  itemSlug: string;
  sizeSlug?: string | null;
  quantity: number;
  modifierSlugs?: string[];
  note?: string;
};

export type CreateOrderInput = {
  brandId: string;
  locationId: string;
  customerId: string | null;
  /** The auth user behind the request, recorded on the created event. */
  actorUserId: string | null;
  fulfillmentType: 'pickup' | 'curbside' | 'catering' | 'delivery';
  scheduledFor: string | null;
  note: string;
  lines: readonly CreateOrderLine[];
  tipCents: number;
  tenderType: OrderTenderType;
  /** The Idempotency-Key the client sent; persisted as orders.client_key. */
  clientKey: string | null;
  taxJurisdictions: readonly TaxJurisdiction[];
};

export type CreateOrderResult = {
  orderId: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  /** True when client_key matched an existing order and nothing was written. */
  replayed: boolean;
};

export type CreateOrderDeps = { db: SupabaseClient };

const MAX_LINES = 100;
const MAX_NOTE_LENGTH = 500;

type ExistingOrder = {
  id: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
};

function asResult(row: ExistingOrder, replayed: boolean): CreateOrderResult {
  return {
    orderId: row.id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    tipCents: row.tip_cents,
    totalCents: row.total_cents,
    replayed,
  };
}

async function findByClientKey(
  db: SupabaseClient,
  brandId: string,
  clientKey: string,
): Promise<ExistingOrder | null> {
  const { data, error } = await db
    .from('orders')
    .select('id, status, subtotal_cents, tax_cents, tip_cents, total_cents')
    .eq('brand_id', brandId)
    .eq('client_key', clientKey)
    .maybeSingle<ExistingOrder>();
  if (error) throw error;
  return data;
}

export async function createOrder(deps: CreateOrderDeps, input: CreateOrderInput): Promise<CreateOrderResult> {
  if (input.lines.length < 1 || input.lines.length > MAX_LINES) {
    throw new OrderError('invalid_request', `An order carries 1..${MAX_LINES} lines.`);
  }
  if (!Number.isInteger(input.tipCents) || input.tipCents < 0) {
    throw new OrderError('invalid_request', 'Tip must be a non-negative integer of cents.');
  }
  if (input.note.length > MAX_NOTE_LENGTH) {
    throw new OrderError('invalid_request', `The order note caps at ${MAX_NOTE_LENGTH} characters.`);
  }
  if (input.scheduledFor !== null && Number.isNaN(Date.parse(input.scheduledFor))) {
    throw new OrderError('invalid_request', 'scheduledFor must be an ISO timestamp.');
  }

  if (input.clientKey) {
    const existing = await findByClientKey(deps.db, input.brandId, input.clientKey);
    if (existing) return asResult(existing, true);
  }

  const location = await deps.db
    .from('locations')
    .select('id, ordering_paused')
    .eq('id', input.locationId)
    .eq('brand_id', input.brandId)
    .maybeSingle<{ id: string; ordering_paused: boolean }>();
  if (location.error) throw location.error;
  if (!location.data) throw new OrderError('location_unknown', 'That location does not exist for this brand.');
  if (location.data.ordering_paused) {
    throw new OrderError('ordering_paused', 'Ordering is paused at this location right now.');
  }

  const slugs = [...new Set(input.lines.map((line) => line.itemSlug))];
  const [items, menus] = await Promise.all([
    deps.db
      .from('menu_items')
      .select('slug, name, base_price_cents, sizes, modifiers, menu_id')
      .eq('brand_id', input.brandId)
      .in('slug', slugs)
      .eq('is_listed', true)
      .eq('is_86d', false)
      .returns<(MenuItemPricing & { menu_id: string })[]>(),
    deps.db
      .from('menus')
      .select('id')
      .eq('brand_id', input.brandId)
      .eq('is_published', true)
      .returns<{ id: string }[]>(),
  ]);
  if (items.error) throw items.error;
  if (menus.error) throw menus.error;
  const publishedMenus = new Set((menus.data ?? []).map((menu) => menu.id));
  const bySlug = new Map(
    (items.data ?? [])
      .filter((item) => publishedMenus.has(item.menu_id))
      .map((item) => [item.slug, item]),
  );

  let subtotalCents = 0;
  const snapshotLines = input.lines.map((line) => {
    const item = bySlug.get(line.itemSlug);
    if (!item) throw new OrderError('item_unavailable', `"${line.itemSlug}" is not available right now.`);
    let priced;
    try {
      priced = priceLine(item, line);
    } catch (error) {
      if (error instanceof MenuPricingError) throw new OrderError(error.code, error.message);
      throw error;
    }
    subtotalCents += priced.lineTotalCents;
    return {
      item_slug: item.slug,
      name: item.name,
      quantity: line.quantity,
      unit_price_cents: priced.unitPriceCents,
      options: priced.optionNames,
      note: line.note ?? '',
    };
  });

  const taxRows = taxRowsFor(subtotalCents, input.taxJurisdictions);
  const taxCents = taxCentsFor(subtotalCents, input.taxJurisdictions);
  const totalCents = subtotalCents + taxCents + input.tipCents;
  const snapshot = {
    lines: snapshotLines,
    tax_rows: taxRows.map((row) => ({ id: row.id, label: row.label, rate: row.rate, amount_cents: row.amountCents })),
    subtotal_cents: subtotalCents,
    tax_cents: taxCents,
    tip_cents: input.tipCents,
    total_cents: totalCents,
    tender_type: input.tenderType,
  };

  const inserted = await deps.db
    .from('orders')
    .insert({
      brand_id: input.brandId,
      location_id: input.locationId,
      customer_id: input.customerId,
      fulfillment_type: input.fulfillmentType,
      scheduled_for: input.scheduledFor,
      note: input.note,
      totals: snapshot,
      subtotal_cents: subtotalCents,
      tax_cents: taxCents,
      tip_cents: input.tipCents,
      total_cents: totalCents,
      tender_type: input.tenderType,
      client_key: input.clientKey,
    })
    .select('id, status, subtotal_cents, tax_cents, tip_cents, total_cents')
    .single<ExistingOrder>();
  if (inserted.error) {
    // Two rings of the same client_key raced: the UNIQUE lost this insert,
    // so the winner IS this order — return it.
    if (inserted.error.code === '23505' && input.clientKey) {
      const winner = await findByClientKey(deps.db, input.brandId, input.clientKey);
      if (winner) return asResult(winner, true);
    }
    throw inserted.error;
  }
  const order = inserted.data;

  const createdEvent = await deps.db.from('order_events').insert({
    brand_id: input.brandId,
    order_id: order.id,
    type: 'created',
    snapshot,
    actor_user_id: input.actorUserId,
    source: 'customer',
  });
  if (createdEvent.error) throw createdEvent.error;

  if (IMMEDIATE_TENDERS.has(input.tenderType)) {
    const paidEvent = await deps.db.from('order_events').insert({
      brand_id: input.brandId,
      order_id: order.id,
      type: 'paid',
      snapshot: { ...snapshot, settlement: input.tenderType === 'pay_at_pickup' ? 'at_pickup' : 'external' },
      source: 'system',
    });
    if (paidEvent.error) throw paidEvent.error;
    order.status = 'paid';
    if (input.customerId) {
      await recordLoyaltyEarn(deps.db, {
        brandId: input.brandId,
        customerId: input.customerId,
        orderId: order.id,
        subtotalCents,
      });
    }
  }

  return asResult(order, false);
}

/**
 * The earn on a paid order: subtotal qualifies, tax and tip never. Creates
 * the loyalty account on first earn so a brand-new guest's first coffee
 * counts. Returns the points granted.
 */
export async function recordLoyaltyEarn(
  db: SupabaseClient,
  input: { brandId: string; customerId: string; orderId: string; subtotalCents: number },
): Promise<number> {
  const earned = pointsEarnedFor(input.subtotalCents);
  if (earned <= 0) return 0;
  let { data: account } = await db
    .from('loyalty_accounts')
    .select('id, points_balance, lifetime_points')
    .eq('customer_id', input.customerId)
    .maybeSingle<{ id: string; points_balance: number; lifetime_points: number }>();
  if (!account) {
    const created = await db
      .from('loyalty_accounts')
      .insert({ brand_id: input.brandId, customer_id: input.customerId })
      .select('id, points_balance, lifetime_points')
      .single<{ id: string; points_balance: number; lifetime_points: number }>();
    if (created.error) throw created.error;
    account = created.data;
  }
  const earnEvent = await db.from('loyalty_events').insert({
    brand_id: input.brandId,
    account_id: account.id,
    order_id: input.orderId,
    type: 'earn',
    points: earned,
  });
  if (earnEvent.error) throw earnEvent.error;
  const updated = await db
    .from('loyalty_accounts')
    .update({
      points_balance: account.points_balance + earned,
      lifetime_points: account.lifetime_points + earned,
    })
    .eq('id', account.id);
  if (updated.error) throw updated.error;
  return earned;
}

/** The cart lines in Square's shape. Pure; covered by orders.test.ts. */
export function buildSquareLines(
  lines: readonly { name: string; quantity: number; unitPriceCents: number; options: readonly string[] }[],
): SquareOrderLine[] {
  return lines.map((line) => ({
    name: line.options.length > 0 ? `${line.name} (${line.options.join(', ')})` : line.name,
    quantity: String(line.quantity),
    base_price_money: { amount: line.unitPriceCents, currency: 'USD' },
  }));
}

export type CapturePaymentDeps = {
  db: SupabaseClient;
  square: SquareConfig;
  locationAccessToken: string;
  squareLocationId: string;
  feeConfig: FeeConfig;
  locationTimezone: string;
};

export type CapturePaymentInput = {
  orderId: string;
  /** Card token from the app's payment SDK. */
  sourceId: string;
};

type SnapshotLine = {
  name: string;
  quantity: number;
  unit_price_cents: number;
  options: readonly string[];
};

export async function captureSquarePayment(
  deps: CapturePaymentDeps,
  input: CapturePaymentInput,
): Promise<{ orderId: string; squarePaymentId: string }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, location_id, customer_id, status, totals, subtotal_cents, tip_cents, total_cents, stored_value_applied_cents, square_payment_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      location_id: string;
      customer_id: string | null;
      status: string;
      totals: { lines?: SnapshotLine[] } & Record<string, unknown>;
      subtotal_cents: number;
      tip_cents: number;
      total_cents: number;
      stored_value_applied_cents: number;
      square_payment_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');
  // A retried capture after a lost response: the first one won.
  if (order.square_payment_id) return { orderId: order.id, squarePaymentId: order.square_payment_id };
  if (order.status !== 'created') {
    throw new OrderError('invalid_request', `Order is ${order.status}; only a created order can be captured.`);
  }

  const lines = (order.totals.lines ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    options: line.options ?? [],
  }));
  const squareOrder = await createSquareOrder(deps.square, deps.locationAccessToken, {
    squareLocationId: deps.squareLocationId,
    referenceId: order.id,
    lines: buildSquareLines(lines),
  });
  const squareOrderId = squareOrder.order?.id;
  if (!squareOrderId) throw new Error('Square returned no order id.');

  // The card charge is what stored value did not cover.
  const cardChargeCents = order.total_cents - order.stored_value_applied_cents;

  // Rule 3: the month's gross so far decides the tier for this payment.
  const monthKey = feeMonthKey(new Date(), deps.locationTimezone);
  const { data: monthRows, error: monthError } = await deps.db
    .from('platform_fees')
    .select('gross_cents, created_at')
    .eq('location_id', order.location_id)
    .gte('created_at', `${monthKey}-01`);
  if (monthError) throw monthError;
  const monthGrossBefore = (monthRows ?? []).reduce(
    (sum: number, row: { gross_cents: number }) => sum + row.gross_cents, 0);
  const fee = computeAppFeeCents(deps.feeConfig, monthGrossBefore, cardChargeCents);

  const payment = await createSquarePayment(deps.square, deps.locationAccessToken, {
    sourceId: input.sourceId,
    squareOrderId,
    referenceId: order.id,
    amountCents: cardChargeCents - order.tip_cents,
    tipCents: order.tip_cents,
    appFeeCents: fee.feeCents,
  });
  const paymentId = payment.payment?.id;
  if (!paymentId) throw new Error('Square returned no payment id.');

  await deps.db
    .from('orders')
    .update({ square_order_id: squareOrderId, square_payment_id: paymentId })
    .eq('id', order.id);

  // The paid event: state moves through order_events only (rule 2). The
  // webhook will assert paid again with its own event id; the trigger treats
  // the re-assertion as idempotent.
  const { error: eventError } = await deps.db.from('order_events').insert({
    brand_id: order.brand_id,
    order_id: order.id,
    type: 'paid',
    snapshot: { ...order.totals, square_payment_id: paymentId, card_charge_cents: cardChargeCents },
    source: 'system',
  });
  if (eventError) throw eventError;

  const { error: feeError } = await deps.db.from('platform_fees').insert({
    brand_id: order.brand_id,
    location_id: order.location_id,
    order_id: order.id,
    gross_cents: cardChargeCents,
    fee_cents: fee.feeCents,
    fee_bps_applied: fee.feeBpsApplied,
    square_payment_id: paymentId,
  });
  if (feeError) throw feeError;

  if (order.customer_id) {
    await recordLoyaltyEarn(deps.db, {
      brandId: order.brand_id,
      customerId: order.customer_id,
      orderId: order.id,
      subtotalCents: order.subtotal_cents,
    });
  }

  return { orderId: order.id, squarePaymentId: paymentId };
}
