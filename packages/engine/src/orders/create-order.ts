/**
 * Order placement, tender-first.
 *
 * createOrder is the money path's front half: recompute every cent from
 * menu_items (the client only ever sends slugs), then atomically commit the
 * order row and created event. Only an attended external POS settles during
 * that commit; pay-at-pickup stays created until staff records collection.
 * Idempotent on client_key: a retried request returns the complete first order
 * instead of ringing a guest up twice or accepting a half-written checkout.
 */
import type { OrderSnapshotLine } from '@platform/domain';
import { requireSinglePublishedMenuId } from '@platform/schema';

import { priceLine, MenuPricingError } from '../menu-pricing';
import { taxCentsFor, taxRowsFor } from '../tax';

import {
  committedResult,
  resolveOrderReplay,
  throwOrderRpcError,
  type OrderMenuItem,
} from './internal';
import { packContentsForLines } from './pack-contents';
import { orderRequestFingerprint, totalExceedsApprovedMaximum } from './request';
import {
  OrderError,
  type CreateOrderDeps,
  type CreateOrderInput,
  type CreateOrderResult,
} from './types';

const MAX_LINES = 100;
const MAX_NOTE_LENGTH = 500;
/** How far ahead an order may be scheduled, and how late a clock may run. */
const SCHEDULE_HORIZON_DAYS = 30;
const SCHEDULE_HORIZON_MS = SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000;
// A phone whose clock is a few minutes behind should not lose its order.
const SCHEDULE_GRACE_MS = 15 * 60 * 1000;

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
