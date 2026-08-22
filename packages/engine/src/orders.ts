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
import { pointsEarnedFor, pointsToReverse } from './loyalty';
import { priceLine, MenuPricingError, type MenuItemPricing } from './menu-pricing';
import { taxCentsFor, taxRowsFor, type TaxJurisdiction } from './tax';
import {
  createPaymentLink,
  createSquareOrder,
  createSquarePayment,
  refundSquarePayment,
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
    | 'refund_unavailable'
    | 'cancel_unavailable'
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
  const account = await loyaltyAccountFor(db, input);
  const earnEvent = await db.from('loyalty_events').insert({
    brand_id: input.brandId,
    account_id: account.id,
    order_id: input.orderId,
    type: 'earn',
    points: earned,
  });
  if (earnEvent.error) throw earnEvent.error;
  // Relative, in one statement: an absolute write computed from a read taken
  // moments earlier silently discards any movement that happened in between.
  const { error } = await db.rpc('loyalty_adjust', { account: account.id, delta: earned });
  if (error) throw error;
  return earned;
}

/**
 * The platform's cut for one settled card payment (rule 3), written once.
 *
 * platform_fees is both the revenue record and the input to the volume tier —
 * appFeeForCharge sums the month's rows to decide which rate applies — so a
 * payment that never writes one is billed at tier 1 forever and quietly
 * under-reports the platform's own revenue. `square_payment_id` is UNIQUE, so
 * a replayed settlement lands on the conflict rather than a second row.
 */
export async function recordPlatformFee(
  db: SupabaseClient,
  input: {
    brandId: string;
    locationId: string;
    orderId: string;
    squarePaymentId: string;
    grossCents: number;
  },
): Promise<void> {
  if (input.grossCents <= 0) return;
  const brand = await db
    .from('brands')
    .select('fee_bps, fee_bps_tier2, tier_threshold_cents')
    .eq('id', input.brandId)
    .single<{ fee_bps: number; fee_bps_tier2: number; tier_threshold_cents: number }>();
  if (brand.error) throw brand.error;
  const location = await db
    .from('locations')
    .select('timezone')
    .eq('id', input.locationId)
    .single<{ timezone: string | null }>();
  if (location.error) throw location.error;

  const fee = await appFeeForCharge(db, {
    locationId: input.locationId,
    chargeCents: input.grossCents,
    feeConfig: {
      feeBps: Number(brand.data.fee_bps),
      feeBpsTier2: Number(brand.data.fee_bps_tier2),
      tierThresholdCents: Number(brand.data.tier_threshold_cents),
    },
    locationTimezone: location.data.timezone ?? 'UTC',
  });

  const { error } = await db.from('platform_fees').insert({
    brand_id: input.brandId,
    location_id: input.locationId,
    order_id: input.orderId,
    gross_cents: input.grossCents,
    fee_cents: fee.feeCents,
    fee_bps_applied: fee.feeBpsApplied,
    square_payment_id: input.squarePaymentId,
  });
  // Already recorded for this payment.
  if (error && error.code !== '23505') throw error;
}

/** The guest's account, created on first contact so a first coffee counts. */
async function loyaltyAccountFor(
  db: SupabaseClient,
  input: { brandId: string; customerId: string },
): Promise<{ id: string }> {
  const found = await db
    .from('loyalty_accounts')
    .select('id')
    .eq('customer_id', input.customerId)
    .maybeSingle<{ id: string }>();
  // Checked, not discarded: a swallowed read error used to look like "no
  // account", and the insert that followed hit unique (customer_id).
  if (found.error) throw found.error;
  if (found.data) return found.data;
  const created = await db
    .from('loyalty_accounts')
    .insert({ brand_id: input.brandId, customer_id: input.customerId })
    .select('id')
    .single<{ id: string }>();
  if (created.error) {
    // Two first orders at once: the loser reads the winner's row.
    if (created.error.code === '23505') {
      const winner = await db
        .from('loyalty_accounts')
        .select('id')
        .eq('customer_id', input.customerId)
        .single<{ id: string }>();
      if (winner.error) throw winner.error;
      return winner.data;
    }
    throw created.error;
  }
  return created.data;
}

/**
 * Takes back the points an order earned, once and only once.
 *
 * Both callers need this to be idempotent for different reasons: Square
 * retries a refund delivery (the event id is deduplicated, but everything
 * after it used to run again), and a guest can cancel an order that a refund
 * already reversed. The unique index on (order_id) where type = 'reverse'
 * makes "once" true even when two callers race.
 *
 * `refundedCents` is what actually went back, so a partial refund takes back
 * a proportional share rather than the whole earn.
 */
export async function reverseLoyaltyEarn(
  db: SupabaseClient,
  input: {
    brandId: string;
    customerId: string | null;
    orderId: string;
    orderTotalCents: number;
    refundedCents: number;
  },
): Promise<number> {
  if (!input.customerId) return 0;
  const earn = await db
    .from('loyalty_events')
    .select('points, account_id')
    .eq('order_id', input.orderId)
    .eq('type', 'earn')
    .maybeSingle<{ points: number; account_id: string }>();
  if (earn.error) throw earn.error;
  if (!earn.data) return 0;

  const points = pointsToReverse(earn.data.points, input.orderTotalCents, input.refundedCents);
  if (points <= 0) return 0;

  const event = await db.from('loyalty_events').insert({
    brand_id: input.brandId,
    account_id: earn.data.account_id,
    order_id: input.orderId,
    type: 'reverse',
    points: -points,
  });
  // Already reversed: the unique index caught a retry, and the balance was
  // moved by whoever got there first.
  if (event.error) {
    if (event.error.code === '23505') return 0;
    throw event.error;
  }
  const { error } = await db.rpc('loyalty_adjust', { account: earn.data.account_id, delta: -points });
  if (error) throw error;
  return points;
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
  const fee = await appFeeForCharge(deps.db, {
    locationId: order.location_id,
    chargeCents: cardChargeCents,
    feeConfig: deps.feeConfig,
    locationTimezone: deps.locationTimezone,
  });

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

/**
 * Rule 3's tiering needs the month's gross before this charge, per location.
 * Both money paths ask the same question, so they ask it in one place.
 */
async function appFeeForCharge(
  db: SupabaseClient,
  input: { locationId: string; chargeCents: number; feeConfig: FeeConfig; locationTimezone: string },
): Promise<{ feeCents: number; feeBpsApplied: number }> {
  const monthKey = feeMonthKey(new Date(), input.locationTimezone);
  const { data, error } = await db
    .from('platform_fees')
    .select('gross_cents, created_at')
    .eq('location_id', input.locationId)
    .gte('created_at', `${monthKey}-01`);
  if (error) throw error;
  const monthGrossBefore = (data ?? []).reduce(
    (sum: number, row: { gross_cents: number }) => sum + row.gross_cents, 0);
  return computeAppFeeCents(input.feeConfig, monthGrossBefore, input.chargeCents);
}

/**
 * What to call the tax line on the checkout page. One authority keeps its own
 * name; several become a single "Sales Tax" charge, because the guest is
 * paying one rounded sum and itemising four rates on a payment page invites
 * a cent-level argument the receipt already answers.
 */
function taxLabelFor(totals: { tax_rows?: { label?: string }[] } & Record<string, unknown>): string {
  const rows = totals.tax_rows ?? [];
  const single = rows.length === 1 ? rows[0]?.label : undefined;
  return typeof single === 'string' && single.length > 0 ? single : 'Sales Tax';
}

export type CheckoutLinkInput = {
  orderId: string;
  /** Where Square returns the guest; usually the app's order screen. */
  redirectUrl?: string;
  buyerEmail?: string;
};

/**
 * The square_link tender's back half: a Square-hosted checkout page for an
 * order that is already priced and written. Nothing here moves the order —
 * it stays 'created' until Square's webhook says the money arrived, so a
 * guest who abandons the page leaves no phantom paid order behind.
 *
 * Idempotent: an order that already carries a link gets that same link back,
 * because minting a second page for one cart is how a guest pays twice.
 */
export async function createSquareCheckoutLink(
  deps: CapturePaymentDeps,
  input: CheckoutLinkInput,
): Promise<{ orderId: string; checkoutUrl: string; replayed: boolean }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, location_id, status, tender_type, totals, tax_cents, tip_cents, total_cents, stored_value_applied_cents, square_checkout_url')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      location_id: string;
      status: string;
      tender_type: string;
      totals: { lines?: SnapshotLine[] } & Record<string, unknown>;
      tax_cents: number;
      tip_cents: number;
      total_cents: number;
      stored_value_applied_cents: number;
      square_checkout_url: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');
  if (order.square_checkout_url) {
    return { orderId: order.id, checkoutUrl: order.square_checkout_url, replayed: true };
  }
  if (order.tender_type !== 'square_link') {
    throw new OrderError('invalid_request', `Order is a ${order.tender_type} order; only square_link orders get a checkout page.`);
  }
  if (order.status !== 'created') {
    throw new OrderError('invalid_request', `Order is ${order.status}; only a created order can be sent to checkout.`);
  }

  const lines = (order.totals.lines ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    options: line.options ?? [],
  }));
  const chargeCents = order.total_cents - order.stored_value_applied_cents;
  const fee = await appFeeForCharge(deps.db, {
    locationId: order.location_id,
    chargeCents,
    feeConfig: deps.feeConfig,
    locationTimezone: deps.locationTimezone,
  });

  // The page must ask for exactly what the order says, or the guest pays one
  // number while the books, the metrics and the platform's fee use another.
  // The first version sent line items alone: tax and tip were simply never
  // collected, while the fee was still computed on the full total.
  const taxCents = order.tax_cents;
  const tipCents = order.tip_cents;
  const linesTotal = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  if (linesTotal + taxCents + tipCents !== chargeCents) {
    throw new Error(
      `Checkout would not charge the order total: lines ${linesTotal} + tax ${taxCents} + tip ${tipCents} != ${chargeCents}.`,
    );
  }

  const link = await createPaymentLink(deps.square, deps.locationAccessToken, {
    squareLocationId: deps.squareLocationId,
    referenceId: order.id,
    lines: buildSquareLines(lines),
    taxCents,
    taxLabel: taxLabelFor(order.totals),
    tipCents,
    appFeeCents: fee.feeCents,
    ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
    ...(input.buyerEmail ? { buyerEmail: input.buyerEmail } : {}),
  });
  const checkoutUrl = link.payment_link?.url;
  if (!checkoutUrl) throw new Error('Square returned no checkout URL.');

  const { error: saveError } = await deps.db
    .from('orders')
    .update({
      square_checkout_url: checkoutUrl,
      ...(link.payment_link?.order_id ? { square_order_id: link.payment_link.order_id } : {}),
    })
    .eq('id', order.id);
  if (saveError) throw saveError;

  return { orderId: order.id, checkoutUrl, replayed: false };
}

/** Cancellable by the guest only while the shop has not started making it. */
const GUEST_CANCELLABLE: ReadonlySet<string> = new Set(['created', 'paid']);

export type CancelOrderInput = {
  orderId: string;
  /** The guest's customer row. The order must be theirs. */
  customerId: string;
  actorUserId: string | null;
  reason: string;
};

/**
 * A guest calling off their own order.
 *
 * The state machine has always allowed created/paid -> cancelled and the
 * event table has always allowed a 'customer' source, but nothing wrote one:
 * a guest who ordered by mistake had no way out, and the shop got a drink
 * ticket nobody would collect. This is the missing writer.
 *
 * Two limits, both about honesty rather than permission. Once the barista
 * hits Start, the drink exists — that cancellation is a conversation at the
 * counter, not a button. And an order whose card already charged needs the
 * money returned, which only staff can do through Square, so it says so
 * instead of quietly cancelling and keeping the payment.
 */
export async function cancelOrder(
  deps: CreateOrderDeps,
  input: CancelOrderInput,
): Promise<{ orderId: string; status: string; alreadyCancelled: boolean }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, customer_id, status, total_cents, square_payment_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      customer_id: string | null;
      status: string;
      total_cents: number;
      square_payment_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  // Same answer for "no such order" and "not yours": a guest must not be able
  // to probe which order ids exist.
  if (!order || order.customer_id !== input.customerId) {
    throw new OrderError('invalid_request', 'That order does not exist.');
  }
  if (order.status === 'cancelled') {
    return { orderId: order.id, status: 'cancelled', alreadyCancelled: true };
  }
  if (order.square_payment_id) {
    throw new OrderError('cancel_unavailable',
      'This order is already paid by card. Ask the shop to cancel and refund it.');
  }
  if (!GUEST_CANCELLABLE.has(order.status)) {
    throw new OrderError('cancel_unavailable',
      order.status === 'in_progress' || order.status === 'ready'
        ? 'The shop has already started this order — talk to them at the counter.'
        : `This order is ${order.status} and can no longer be cancelled.`);
  }

  const { error } = await deps.db.from('order_events').insert({
    brand_id: order.brand_id,
    order_id: order.id,
    type: 'cancelled',
    snapshot: { reason: input.reason, cancelled_by: 'guest' },
    actor_user_id: input.actorUserId,
    source: 'customer',
  });
  if (error) {
    // The barista started it between the read and the write: the trigger
    // refuses the transition. Only that gets the counter sentence — every
    // other failure is an infrastructure problem, and claiming the shop
    // started an order it did not is both a lie to the guest and a 409 that
    // hides a 500 from whoever is watching the logs.
    if (/illegal order transition/i.test(error.message)) {
      throw new OrderError('cancel_unavailable',
        'The shop started this order just now — talk to them at the counter.');
    }
    throw error;
  }

  // A pay-at-pickup order earns its points the moment it is placed, because
  // the shop is about to make it. Cancelling has to give them back, or
  // ordering and cancelling in a loop mints points out of nothing.
  await reverseLoyaltyEarn(deps.db, {
    brandId: order.brand_id,
    customerId: order.customer_id,
    orderId: order.id,
    orderTotalCents: order.total_cents,
    refundedCents: order.total_cents,
  });
  return { orderId: order.id, status: 'cancelled', alreadyCancelled: false };
}

export type RefundDeps = {
  db: SupabaseClient;
  square: SquareConfig;
  locationAccessToken: string;
};

export type RefundInput = {
  orderId: string;
  /** Cents to return, or everything not already returned. */
  amountCents: number | 'full';
  reason: string;
  actorUserId: string | null;
  /**
   * Identifies this refund ATTEMPT. Square deduplicates on it, so a retry
   * after a lost response returns the first refund instead of sending the
   * money twice — and two genuinely separate refunds of equal size must
   * carry different keys, which keying on the amount could never do.
   */
  requestKey: string;
};

/**
 * What has already gone back on this order.
 *
 * Keyed on the refund id in the snapshot rather than the event type: a
 * partial refund records itself without moving the order (see below), so it
 * does not carry type 'refunded' and a type filter would miss exactly the
 * events this sum exists to count.
 */
type RefundedEvent = { snapshot: { refund_id?: unknown; amount_cents?: unknown } | null };

async function refundedSoFar(db: SupabaseClient, orderId: string): Promise<number> {
  const { data, error } = await db
    .from('order_events')
    .select('snapshot')
    .eq('order_id', orderId)
    .returns<RefundedEvent[]>();
  if (error) throw error;
  return (data ?? []).reduce((sum, row) => {
    if (typeof row.snapshot?.refund_id !== 'string') return sum;
    const amount = row.snapshot.amount_cents;
    return sum + (typeof amount === 'number' ? amount : 0);
  }, 0);
}

/** States a refund may legally follow. Checked before money moves. */
const REFUNDABLE: ReadonlySet<string> = new Set(['paid', 'in_progress', 'ready', 'picked_up', 'refunded']);

/**
 * Money back through Square, then the event that records it. Only a card
 * order can refund here: a pay-at-pickup order never charged a card through
 * the platform, so returning that money is a register action and saying so
 * beats a failure the barista cannot act on.
 */
export async function refundOrderPayment(
  deps: RefundDeps,
  input: RefundInput,
): Promise<{ orderId: string; refundId: string; amountCents: number }> {
  const loaded = await deps.db
    .from('orders')
    .select('id, brand_id, status, total_cents, stored_value_applied_cents, tender_type, square_payment_id')
    .eq('id', input.orderId)
    .maybeSingle<{
      id: string;
      brand_id: string;
      status: string;
      total_cents: number;
      stored_value_applied_cents: number;
      tender_type: string;
      square_payment_id: string | null;
    }>();
  if (loaded.error) throw loaded.error;
  const order = loaded.data;
  if (!order) throw new OrderError('invalid_request', 'That order does not exist.');
  if (!order.square_payment_id) {
    throw new OrderError('refund_unavailable',
      'This order was not paid by card through the app, so there is nothing to return here — refund it at the register.');
  }
  // Checked BEFORE Square is called. Money that moves and then cannot be
  // recorded is the one failure with no clean recovery: the guest has their
  // refund, the platform has no trace of it, and every retry repeats the
  // question. A cancelled order has no legal edge to refunded, so it would
  // have charged and then thrown.
  if (!REFUNDABLE.has(order.status)) {
    throw new OrderError('refund_unavailable',
      `This order is ${order.status}; it cannot be refunded.`);
  }

  const alreadyRefunded = await refundedSoFar(deps.db, order.id);
  const refundable = order.total_cents - order.stored_value_applied_cents - alreadyRefunded;
  if (refundable <= 0) {
    throw new OrderError('refund_unavailable', 'This order has already been fully refunded.');
  }
  const amountCents = input.amountCents === 'full' ? refundable : input.amountCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new OrderError('invalid_request', 'Refund amount must be a whole number of cents.');
  }
  // The cap is what is LEFT, not the order total: three $10 refunds on a $22
  // order each passed a per-call check that never looked at the other two.
  if (amountCents > refundable) {
    throw new OrderError('invalid_request',
      `Only ${refundable} cents are left to refund on this order.`);
  }

  const refund = await refundSquarePayment(deps.square, deps.locationAccessToken, {
    paymentId: order.square_payment_id,
    amountCents,
    // The caller's key, not the amount: two separate $5 refunds are two
    // refunds, and keying on the amount made Square treat the second as a
    // replay of the first — returning $5 while the books recorded $10.
    referenceId: input.requestKey,
    reason: input.reason,
  });
  const refundId = refund.refund?.id;
  if (!refundId) throw new Error('Square returned no refund id.');

  // A refund that does not cover the order leaves it where it was: 'refunded'
  // is terminal, and asserting it for a $2 courtesy refund stranded a $22
  // order the barista still had to hand over, with no legal move left.
  const fullyRefunded = alreadyRefunded + amountCents >= order.total_cents - order.stored_value_applied_cents;
  const { error: eventError } = await deps.db.from('order_events').insert({
    brand_id: order.brand_id,
    order_id: order.id,
    // Partial refunds record themselves without moving the order.
    type: fullyRefunded ? 'refunded' : order.status,
    snapshot: {
      refund_id: refundId,
      amount_cents: amountCents,
      reason: input.reason,
      partial: !fullyRefunded,
    },
    actor_user_id: input.actorUserId,
    source: 'operator',
  });
  if (eventError) throw eventError;

  return { orderId: order.id, refundId, amountCents };
}
