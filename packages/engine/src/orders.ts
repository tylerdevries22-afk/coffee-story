/**
 * Order placement, tender-first.
 *
 * createOrder is the money path's front half: recompute every cent from
 * menu_items (the client only ever sends slugs), then atomically commit the
 * order row and created event. Only an attended external POS settles during
 * that commit; pay-at-pickup stays created until staff records collection.
 * Idempotent on client_key: a retried request returns the complete first order
 * instead of ringing a guest up twice or accepting a half-written checkout.
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
import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { dropVisibility, type OrderSnapshotLine } from '@platform/domain';
import { requireSinglePublishedMenuId, type OrderTenderType } from '@platform/schema';

import { computeAppFeeCents, feeMonthRange, type FeeConfig } from './fees';
import { priceLine, MenuPricingError, type MenuItemPricing } from './menu-pricing';
import {
  PackOrderError,
  validatePackSelection,
  type PackChoiceAvailability,
  type ResolvedPackContent,
} from './pack-order';
import {
  manualRefundEvent,
  refundedCentsFrom,
  replayForClaimedRefund,
  replayForRequest,
  replayForSquareRefund,
  type RefundEventRecord,
} from './refunds';
import { taxCentsFor, taxRowsFor, type TaxJurisdiction } from './tax';
import {
  createPaymentLink,
  createSquareOrder,
  createSquarePayment,
  refundSquarePayment,
  type SquareConfig,
  type SquareOrderLine,
} from './square/client';

export type { OrderTenderType };
/** `app.order_channel`. Where the order was taken, not how it was paid. */
export type OrderChannel = 'app' | 'web' | 'kiosk' | 'pos';

export class OrderError extends Error {
  readonly code:
    | 'invalid_request'
    | 'location_unknown'
    | 'ordering_paused'
    | 'idempotency_conflict'
    | 'price_changed'
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
  packContents?: { itemSlug: string; quantity: number }[];
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
  /** Client-side ceiling already shown to the guest; never an authority on price. */
  maximumTotalCents?: number;
  tenderType: OrderTenderType;
  /**
   * Where the order came from. Derived server-side from who is calling, never
   * from the body: the column existed with `default 'app'` and nothing ever
   * wrote it, so `in_app_share` on the HQ dashboard and in the weekly owner
   * email has been pinned at 100% for every brand since the view shipped.
   */
  channel: OrderChannel;
  /**
   * A display-safe guest name for the ticket, already validated by the caller
   * with `parseGuestLabel`. Null when the guest gave none -- the column stays
   * null rather than holding an empty string, because the board renders it
   * directly.
   */
  guestLabel: string | null;
  /**
   * The paired device that took the order (0038). Null for app and web. It is
   * what narrows `orders_kiosk_select` to the device's own orders rather than
   * every order at that location in the past hour.
   */
  deviceId: string | null;
  /** Required Idempotency-Key; persisted as orders.client_key. */
  clientKey: string;
  taxJurisdictions: readonly TaxJurisdiction[];
};

export type CreateOrderResult = {
  orderId: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  /**
   * The ticket the shop calls out. Assigned by a trigger, so it comes back with
   * the row rather than being computed here -- a surface that invents its own
   * number is how a barista and a pickup board end up disagreeing.
   */
  dailyNumber: number | null;
  /** True when client_key matched an existing order and nothing was written. */
  replayed: boolean;
};

export type CreateOrderDeps = { db: SupabaseClient };

const MAX_LINES = 100;
const MAX_NOTE_LENGTH = 500;
const MAX_PACK_CONTENT_ENTRIES = 500;
/** How far ahead an order may be scheduled, and how late a clock may run. */
const SCHEDULE_HORIZON_DAYS = 30;
const SCHEDULE_HORIZON_MS = SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
// A phone whose clock is a few minutes behind should not lose its order.
const SCHEDULE_GRACE_MS = 15 * 60 * 1000;

type ExistingOrder = {
  id: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  /** Assigned by the app.assign_daily_number trigger, so it is only ever read. */
  daily_number: number | null;
};

type OrderMenuItem = MenuItemPricing & {
  id: string;
  menu_id: string;
  pack_size: number | null;
  choice_source: 'lineup' | 'static' | null;
  pack_choice_slugs: string[];
};

type PackChoiceRow = Pick<OrderMenuItem, 'id' | 'slug' | 'name' | 'pack_size'> & {
  is_listed: boolean;
  is_86d: boolean;
  rotation: PackChoiceAvailability['rotation'];
};

type PackDropRow = {
  item_id: string;
  status: 'draft' | 'scheduled' | 'revealed' | 'live' | 'ended' | 'cancelled';
  reveal_at: string | null;
  starts_at: string;
  ends_at: string;
};

/**
 * Stable digest of the checkout request before menu, availability or tax data
 * is consulted. Optional fields are normalized to the behavior the engine
 * applies, so omitted and explicit empty values do not create false
 * conflicts. Tax jurisdictions are intentionally absent: they are mutable
 * server configuration, not input from the checkout attempt.
 */
export function orderRequestFingerprint(input: CreateOrderInput): string {
  const canonical = {
    version: 1,
    brandId: input.brandId,
    locationId: input.locationId,
    customerId: input.customerId,
    actorUserId: input.actorUserId,
    fulfillmentType: input.fulfillmentType,
    scheduledFor: input.scheduledFor,
    note: input.note,
    lines: input.lines.map((line) => ({
      itemSlug: line.itemSlug,
      sizeSlug: line.sizeSlug ?? null,
      quantity: line.quantity,
      modifierSlugs: line.modifierSlugs ?? [],
      note: line.note ?? '',
      packContents: (line.packContents ?? []).map((content) => ({
        itemSlug: content.itemSlug,
        quantity: content.quantity,
      })),
    })),
    tipCents: input.tipCents,
    maximumTotalCents: input.maximumTotalCents ?? null,
    tenderType: input.tenderType,
    channel: input.channel,
    guestLabel: input.guestLabel,
    deviceId: input.deviceId,
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function asResult(row: ExistingOrder, replayed: boolean): CreateOrderResult {
  return {
    orderId: row.id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    taxCents: row.tax_cents,
    tipCents: row.tip_cents,
    totalCents: row.total_cents,
    dailyNumber: row.daily_number,
    replayed,
  };
}

function committedResult(value: unknown): CreateOrderResult {
  const payload = value as { order?: Partial<ExistingOrder>; replayed?: unknown } | null;
  const row = payload?.order;
  if (!row || typeof row.id !== 'string' || typeof row.status !== 'string'
    || typeof row.subtotal_cents !== 'number' || !Number.isInteger(row.subtotal_cents)
    || typeof row.tax_cents !== 'number' || !Number.isInteger(row.tax_cents)
    || typeof row.tip_cents !== 'number' || !Number.isInteger(row.tip_cents)
    || typeof row.total_cents !== 'number' || !Number.isInteger(row.total_cents)
    || (row.daily_number !== null
      && (typeof row.daily_number !== 'number' || !Number.isInteger(row.daily_number)))
    || typeof payload?.replayed !== 'boolean') {
    throw new Error('commit_order returned an invalid result.');
  }
  return asResult(row as ExistingOrder, payload.replayed);
}

type OrderRpcError = { code?: string; message: string };

function throwOrderRpcError(error: OrderRpcError): never {
  if (error.code === '22023' && /idempotency key was already used/i.test(error.message)) {
    throw new OrderError('idempotency_conflict',
      'That Idempotency-Key was already used for a different order request.');
  }
  throw error;
}

async function resolveOrderReplay(
  db: SupabaseClient,
  input: Pick<CreateOrderInput, 'brandId' | 'clientKey'>,
  requestFingerprint: string,
): Promise<CreateOrderResult | null> {
  const replay = await db.rpc('resolve_order_replay', {
    p_brand_id: input.brandId,
    p_client_key: input.clientKey,
    p_request_fingerprint: requestFingerprint,
  });
  if (replay.error) throwOrderRpcError(replay.error);
  return replay.data === null ? null : committedResult(replay.data);
}

/** A client ceiling can only reject an increase; it never sets a price. */
export function totalExceedsApprovedMaximum(totalCents: number, maximumTotalCents?: number): boolean {
  return maximumTotalCents !== undefined && totalCents > maximumTotalCents;
}

async function packContentsForLines(
  db: SupabaseClient,
  brandId: string,
  menuId: string,
  lines: readonly CreateOrderLine[],
  items: ReadonlyMap<string, OrderMenuItem>,
): Promise<ResolvedPackContent[][]> {
  const entryCount = lines.reduce((total, line) => total + (line.packContents?.length ?? 0), 0);
  if (entryCount > MAX_PACK_CONTENT_ENTRIES) {
    throw new OrderError('invalid_request', `An order may carry at most ${MAX_PACK_CONTENT_ENTRIES} pack entries.`);
  }
  const contentSlugs = [...new Set(lines.flatMap((line) => line.packContents?.map((entry) => entry.itemSlug) ?? []))];
  const choices = contentSlugs.length === 0
    ? []
    : await fetchPackChoices(db, brandId, menuId, contentSlugs);
  const orderableDropIds = await fetchOrderableDropIds(db, brandId, choices);
  const availability = choices.map<PackChoiceAvailability>((choice) => ({
    itemSlug: choice.slug,
    name: choice.name,
    isListed: choice.is_listed,
    is86d: choice.is_86d,
    packSize: choice.pack_size,
    rotation: choice.rotation,
    dropOrderable: orderableDropIds.has(choice.id),
  }));
  return lines.map((line) => {
    const item = items.get(line.itemSlug);
    if (!item) throw new OrderError('item_unavailable', `"${line.itemSlug}" is not available right now.`);
    try {
      return validatePackSelection({
        packSize: item.pack_size,
        choiceSource: item.choice_source,
        eligibleItemSlugs: item.pack_choice_slugs,
      }, line.packContents, availability);
    } catch (error) {
      if (error instanceof PackOrderError) throw new OrderError(error.code, error.message);
      throw error;
    }
  });
}

async function fetchPackChoices(
  db: SupabaseClient,
  brandId: string,
  menuId: string,
  slugs: readonly string[],
): Promise<PackChoiceRow[]> {
  const result = await db.from('menu_items')
    .select('id, slug, name, pack_size, is_listed, is_86d, rotation')
    .eq('brand_id', brandId)
    .eq('menu_id', menuId)
    .in('slug', [...slugs])
    .returns<PackChoiceRow[]>();
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function fetchOrderableDropIds(
  db: SupabaseClient,
  brandId: string,
  choices: readonly PackChoiceRow[],
): Promise<ReadonlySet<string>> {
  const rotatingIds = choices.filter((choice) => choice.rotation !== 'permanent').map((choice) => choice.id);
  if (rotatingIds.length === 0) return new Set();
  const result = await db.from('drops')
    .select('item_id, status, reveal_at, starts_at, ends_at')
    .eq('brand_id', brandId)
    .in('item_id', rotatingIds)
    .returns<PackDropRow[]>();
  if (result.error) throw result.error;
  const now = Date.now();
  return new Set((result.data ?? []).filter((drop) => dropVisibility({
    itemId: drop.item_id,
    status: drop.status,
    revealAt: drop.reveal_at === null ? null : Date.parse(drop.reveal_at),
    startsAt: Date.parse(drop.starts_at),
    endsAt: Date.parse(drop.ends_at),
  }, now) === 'orderable').map((drop) => drop.item_id));
}

export async function createOrder(deps: CreateOrderDeps, input: CreateOrderInput): Promise<CreateOrderResult> {
  // Resolve a completed attempt before applying even local validation. A
  // retry after a lost response must return the immutable winner if clocks,
  // catalog state, or local validation limits changed after it committed.
  const requestFingerprint = orderRequestFingerprint(input);
  const replay = await resolveOrderReplay(deps.db, input, requestFingerprint);
  if (replay) return replay;

  if (input.lines.length < 1 || input.lines.length > MAX_LINES) {
    throw new OrderError('invalid_request', `An order carries 1..${MAX_LINES} lines.`);
  }
  if (!Number.isInteger(input.tipCents) || input.tipCents < 0) {
    throw new OrderError('invalid_request', 'Tip must be a non-negative integer of cents.');
  }
  if (input.maximumTotalCents !== undefined
    && (!Number.isInteger(input.maximumTotalCents) || input.maximumTotalCents < 0)) {
    throw new OrderError('invalid_request', 'maximumTotalCents must be non-negative integer cents.');
  }
  if (input.note.length > MAX_NOTE_LENGTH) {
    throw new OrderError('invalid_request', `The order note caps at ${MAX_NOTE_LENGTH} characters.`);
  }

  if (input.scheduledFor !== null) {
    const when = Date.parse(input.scheduledFor);
    if (Number.isNaN(when)) {
      throw new OrderError('invalid_request', 'scheduledFor must be an ISO timestamp.');
    }
    // The app checks the window before it sends, but a direct caller does
    // not: a pickup in the past drops straight into Past orders without ever
    // reaching the board, and one years out sits on the scheduled lane
    // forever. Neither is an order the shop can act on.
    const now = Date.now();
    if (when < now - SCHEDULE_GRACE_MS) {
      throw new OrderError('invalid_request', 'That pickup time has already passed.');
    }
    if (when > now + SCHEDULE_HORIZON_MS) {
      throw new OrderError('invalid_request', `Orders can be scheduled up to ${SCHEDULE_HORIZON_DAYS} days ahead.`);
    }
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

  const menus = await deps.db
    .from('menus')
    .select('id')
    .eq('brand_id', input.brandId)
    .eq('is_published', true)
    .returns<{ id: string }[]>();
  if (menus.error) throw menus.error;
  let menuId: string;
  try {
    menuId = requireSinglePublishedMenuId(menus.data ?? []);
  } catch {
    throw new OrderError('catalog_invalid', 'This brand must have exactly one published menu.');
  }
  const slugs = [...new Set(input.lines.map((line) => line.itemSlug))];
  const items = await deps.db
    .from('menu_items')
    .select('id, slug, name, base_price_cents, sizes, modifiers, menu_id, pack_size, choice_source, pack_choice_slugs')
    .eq('brand_id', input.brandId)
    .eq('menu_id', menuId)
    .in('slug', slugs)
    .eq('is_listed', true)
    .eq('is_86d', false)
    .returns<OrderMenuItem[]>();
  if (items.error) throw items.error;
  const bySlug = new Map((items.data ?? []).map((item) => [item.slug, item]));
  const packContents = await packContentsForLines(deps.db, input.brandId, menuId, input.lines, bySlug);

  let subtotalCents = 0;
  // Typed against the contract in @platform/domain rather than against itself,
  // so a renamed key fails here instead of quietly rendering "Item x1" on
  // every surface that reads the snapshot back.
  const snapshotLines: OrderSnapshotLine[] = input.lines.map((line, index) => {
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
      pack_contents: packContents[index] ?? [],
    };
  });

  const taxRows = taxRowsFor(subtotalCents, input.taxJurisdictions);
  const taxCents = taxCentsFor(subtotalCents, input.taxJurisdictions);
  const totalCents = subtotalCents + taxCents + input.tipCents;
  if (totalExceedsApprovedMaximum(totalCents, input.maximumTotalCents)) {
    throw new OrderError('price_changed', 'The current menu total is higher than the amount the guest approved.');
  }
  const snapshot = {
    request_fingerprint: requestFingerprint,
    lines: snapshotLines,
    tax_rows: taxRows.map((row) => ({ id: row.id, label: row.label, rate: row.rate, amount_cents: row.amountCents })),
    subtotal_cents: subtotalCents,
    tax_cents: taxCents,
    tip_cents: input.tipCents,
    total_cents: totalCents,
    tender_type: input.tenderType,
  };

  const committed = await deps.db.rpc('commit_order', {
    p_brand_id: input.brandId,
    p_location_id: input.locationId,
    p_customer_id: input.customerId,
    p_fulfillment_type: input.fulfillmentType,
    p_scheduled_for: input.scheduledFor,
    p_note: input.note,
    p_totals: snapshot,
    p_subtotal_cents: subtotalCents,
    p_tax_cents: taxCents,
    p_tip_cents: input.tipCents,
    p_total_cents: totalCents,
    p_tender_type: input.tenderType,
    p_channel: input.channel,
    p_guest_label: input.guestLabel,
    p_device_id: input.deviceId,
    p_client_key: input.clientKey,
    p_request_fingerprint: requestFingerprint,
    p_actor_user_id: input.actorUserId,
  });
  if (committed.error) throwOrderRpcError(committed.error);
  return committedResult(committed.data);
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

  await insertPlatformFeeOnce(db, {
    brand_id: input.brandId,
    location_id: input.locationId,
    order_id: input.orderId,
    gross_cents: input.grossCents,
    fee_cents: fee.feeCents,
    fee_bps_applied: fee.feeBpsApplied,
    square_payment_id: input.squarePaymentId,
  });
}

type PlatformFeeInsert = {
  brand_id: string;
  location_id: string;
  order_id: string;
  gross_cents: number;
  fee_cents: number;
  fee_bps_applied: number;
  square_payment_id: string;
};

async function insertPlatformFeeOnce(db: SupabaseClient, row: PlatformFeeInsert): Promise<void> {
  const { error } = await db.from('platform_fees').insert(row);
  // A lost HTTP response can replay after the first insert committed. The
  // payment id is unique, so that conflict is the success we already had.
  if (error && error.code !== '23505') throw error;
}

/** The cart lines in Square's shape. Pure; covered by orders.test.ts. */
export function buildSquareLines(
  lines: readonly {
    name: string;
    quantity: number;
    unitPriceCents: number;
    options: readonly string[];
    packContents?: readonly { name: string; quantity: number }[];
  }[],
): SquareOrderLine[] {
  return lines.map((line) => {
    const packNote = line.packContents && line.packContents.length > 0
      ? `Inside each pack: ${line.packContents.map((content) => `${content.quantity}x ${content.name}`).join(', ')}`
      : undefined;
    return {
      name: line.options.length > 0 ? `${line.name} (${line.options.join(', ')})` : line.name,
      quantity: String(line.quantity),
      base_price_money: { amount: line.unitPriceCents, currency: 'USD' },
      ...(packNote ? { note: packNote } : {}),
    };
  });
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
  pack_contents?: readonly { item_slug: string; name: string; quantity: number }[];
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
  // A retried capture after a lost response must finish the local settlement,
  // not merely notice that Square already charged the card. Linking the
  // payment, recording platform revenue, and appending the paid event are
  // separate database calls because the external charge sits between them.
  // Square's idempotency keys prevent another charge; these local idempotent
  // repairs prevent a linked-but-unpaid order replaying as a false success.
  if (order.square_payment_id) {
    const cardChargeCents = order.total_cents - order.stored_value_applied_cents;
    const fee = await appFeeForCharge(deps.db, {
      locationId: order.location_id,
      chargeCents: cardChargeCents,
      feeConfig: deps.feeConfig,
      locationTimezone: deps.locationTimezone,
    });
    await insertPlatformFeeOnce(deps.db, {
      brand_id: order.brand_id,
      location_id: order.location_id,
      order_id: order.id,
      gross_cents: cardChargeCents,
      fee_cents: fee.feeCents,
      fee_bps_applied: fee.feeBpsApplied,
      square_payment_id: order.square_payment_id,
    });
    if (order.status === 'created') {
      const { error } = await deps.db.from('order_events').insert({
        brand_id: order.brand_id,
        order_id: order.id,
        type: 'paid',
        snapshot: {
          ...order.totals,
          square_payment_id: order.square_payment_id,
          card_charge_cents: cardChargeCents,
          recovered: true,
        },
        source: 'system',
      });
      if (error) throw error;
    }
    return { orderId: order.id, squarePaymentId: order.square_payment_id };
  }
  if (order.status !== 'created') {
    throw new OrderError('invalid_request', `Order is ${order.status}; only a created order can be captured.`);
  }

  const lines = (order.totals.lines ?? []).map((line) => ({
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unit_price_cents,
    options: line.options ?? [],
    packContents: line.pack_contents ?? [],
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

  // Checked, because this is the field a refund later depends on: an
  // unchecked failure here left a charged card on an order the app could
  // never return money for, while the rest of the function reported success.
  const linked = await deps.db
    .from('orders')
    .update({ square_order_id: squareOrderId, square_payment_id: paymentId })
    .eq('id', order.id);
  if (linked.error) {
    throw new Error(
      `Square payment ${paymentId} was taken but could not be recorded on order ${order.id}: ${linked.error.message}`,
    );
  }

  // Record the fee before advancing state. If this call fails, the order is
  // still created and the replay path above repairs it. Once paid is visible,
  // the fee row is therefore already durable.
  await insertPlatformFeeOnce(deps.db, {
    brand_id: order.brand_id,
    location_id: order.location_id,
    order_id: order.id,
    gross_cents: cardChargeCents,
    fee_cents: fee.feeCents,
    fee_bps_applied: fee.feeBpsApplied,
    square_payment_id: paymentId,
  });

  // State moves through order_events only (rule 2). Its database trigger
  // grants loyalty in the same transaction, including staff-recorded cash.
  const { error: eventError } = await deps.db.from('order_events').insert({
    brand_id: order.brand_id,
    order_id: order.id,
    type: 'paid',
    snapshot: { ...order.totals, square_payment_id: paymentId, card_charge_cents: cardChargeCents },
    source: 'system',
  });
  if (eventError) throw eventError;

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
  // The location's own month, as UTC instants: a bare date string resolves
  // at UTC midnight, which is not when the month starts anywhere but UTC.
  const { startIso, endIso } = feeMonthRange(new Date(), input.locationTimezone);
  const { data, error } = await db
    .from('platform_fees')
    .select('gross_cents, created_at')
    .eq('location_id', input.locationId)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
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
    packContents: line.pack_contents ?? [],
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

/** Cancellable by the guest only before any tender has been collected. */
const GUEST_CANCELLABLE: ReadonlySet<string> = new Set(['created']);

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

  // The event trigger reverses any prior earn in this same transaction. A
  // created pay-at-pickup order has no earn to reverse until staff collects.
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
 * Keyed on typed processor identity rather than event type: a partial refund
 * records itself without moving the order (see below), so it does not carry
 * type 'refunded' and a type filter would miss exactly what this sum counts.
 */
async function refundEventsFor(db: SupabaseClient, orderId: string): Promise<RefundEventRecord[]> {
  const { data, error } = await db
    .from('order_events')
    .select('brand_id, order_id, square_refund_id, refund_cents, refund_request_key, snapshot')
    .eq('order_id', orderId)
    .returns<RefundEventRecord[]>();
  if (error) throw error;
  return data ?? [];
}

async function refundEventByRequestKey(
  db: SupabaseClient,
  brandId: string,
  requestKey: string,
): Promise<RefundEventRecord | null> {
  const result = await db
    .from('order_events')
    .select('brand_id, order_id, square_refund_id, refund_cents, refund_request_key, snapshot')
    .eq('brand_id', brandId)
    .eq('refund_request_key', requestKey)
    .maybeSingle<RefundEventRecord>();
  if (result.error) throw result.error;
  return result.data;
}

async function refundEventBySquareId(
  db: SupabaseClient,
  refundId: string,
): Promise<RefundEventRecord | null> {
  const result = await db
    .from('order_events')
    .select('brand_id, order_id, square_refund_id, refund_cents, refund_request_key, snapshot')
    .eq('square_refund_id', refundId)
    .maybeSingle<RefundEventRecord>();
  if (result.error) throw result.error;
  return result.data;
}

async function claimWebhookRefundWinner(
  db: SupabaseClient,
  input: {
    brandId: string;
    orderId: string;
    refundId: string;
    refundCents: number;
    requestKey: string;
    requestedAmount: number | 'full';
  },
) {
  const claimed = await db.rpc('claim_refund_request', {
    p_brand_id: input.brandId,
    p_order_id: input.orderId,
    p_square_refund_id: input.refundId,
    p_refund_cents: input.refundCents,
    p_refund_request_key: input.requestKey,
    p_requested_amount: input.requestedAmount,
  });
  if (claimed.error) {
    if (claimed.error.code === '22023') {
      throw new OrderError('invalid_request',
        'That idempotency key belongs to a different refund attempt.');
    }
    throw claimed.error;
  }
  const replay = claimed.data
    ? replayForClaimedRefund(claimed.data as RefundEventRecord, input)
    : null;
  if (!replay) throw new Error('claim_refund_request returned an invalid refund event.');
  return replay;
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
  const existingAttempt = await refundEventByRequestKey(deps.db, order.brand_id, input.requestKey);
  const priorAttempt = replayForRequest(existingAttempt ? [existingAttempt] : [], {
    brandId: order.brand_id,
    orderId: order.id,
    requestKey: input.requestKey,
    amountCents: input.amountCents,
  });
  if (priorAttempt.outcome === 'match') return priorAttempt.result;
  if (priorAttempt.outcome === 'conflict') {
    throw new OrderError('invalid_request', 'That idempotency key belongs to a different refund attempt.');
  }

  const refundEvents = await refundEventsFor(deps.db, order.id);

  // Checked BEFORE Square is called. Money that moves and then cannot be
  // recorded is the one failure with no clean recovery: the guest has their
  // refund, the platform has no trace of it, and every retry repeats the
  // question. A cancelled order has no legal edge to refunded, so it would
  // have charged and then thrown.
  if (!REFUNDABLE.has(order.status)) {
    throw new OrderError('refund_unavailable',
      `This order is ${order.status}; it cannot be refunded.`);
  }

  const alreadyRefunded = refundedCentsFrom(refundEvents);
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
  const { error: eventError } = await deps.db.from('order_events').insert(manualRefundEvent({
    brandId: order.brand_id,
    orderId: order.id,
    // Partial refunds record themselves without moving the order.
    type: fullyRefunded ? 'refunded' : order.status,
    refundId,
    amountCents,
    requestedAmount: input.amountCents,
    requestKey: input.requestKey,
    reason: input.reason,
    partial: !fullyRefunded,
    actorUserId: input.actorUserId,
  }));
  if (eventError?.code === '23505') {
    const winner = await refundEventBySquareId(deps.db, refundId);
    const processorReplay = winner ? replayForSquareRefund(winner, {
      brandId: order.brand_id,
      orderId: order.id,
      refundId,
      amountCents,
    }) : null;
    if (!winner || !processorReplay) {
      throw new OrderError('invalid_request',
        'That idempotency key belongs to a different refund attempt.');
    }
    const requestReplay = replayForRequest([winner], {
      brandId: order.brand_id,
      orderId: order.id,
      requestKey: input.requestKey,
      amountCents: input.amountCents,
    });
    if (requestReplay.outcome === 'match') return requestReplay.result;
    if (requestReplay.outcome === 'conflict' || winner.refund_request_key !== null) {
      throw new OrderError('invalid_request',
        'That idempotency key belongs to a different refund attempt.');
    }
    return claimWebhookRefundWinner(deps.db, {
      brandId: order.brand_id,
      orderId: order.id,
      refundId,
      refundCents: amountCents,
      requestKey: input.requestKey,
      requestedAmount: input.amountCents,
    });
  }
  if (eventError) throw eventError;

  return { orderId: order.id, refundId, amountCents };
}
