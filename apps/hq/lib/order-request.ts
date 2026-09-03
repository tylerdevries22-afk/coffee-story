/**
 * Everything POST /api/orders refuses before a cent is computed.
 *
 * Beside the route rather than inside it, so the handler reads as the
 * sequence it is -- authenticate, validate, resolve tender, place, answer --
 * instead of five lines of orchestration spread through sixty of guards. The
 * order of these checks is part of the contract: the first failure is the one
 * the client sees.
 *
 * The caller arrives with the body because placement is the one endpoint a
 * paired device may call, so the body has to be checked against who is
 * calling and not only against itself.
 */
import type { PlaceOrderRequest } from '@platform/api-client';
import { parseGuestLabel } from '@platform/domain';
import type { CreateOrderLine, OrderTenderType } from '@platform/engine';

import { idempotencyKeyOf, jsonError, type Caller } from './api-auth';

const FULFILLMENT_TYPES = new Set(['pickup', 'curbside', 'catering', 'delivery']);
const LIVE_TENDERS = new Set<OrderTenderType>(['pay_at_pickup', 'square_link']);

function badLine(line: unknown): boolean {
  const candidate = line as Partial<CreateOrderLine>;
  return (
    typeof candidate?.itemSlug !== 'string'
    || candidate.itemSlug.length === 0
    || candidate.itemSlug.length > 100
    || typeof candidate.quantity !== 'number'
    || (candidate.sizeSlug !== undefined && candidate.sizeSlug !== null && typeof candidate.sizeSlug !== 'string')
    || (candidate.modifierSlugs !== undefined
      && (!Array.isArray(candidate.modifierSlugs)
        || candidate.modifierSlugs.length > 50
        || candidate.modifierSlugs.some((slug) => typeof slug !== 'string')))
    || (candidate.note !== undefined && (typeof candidate.note !== 'string' || candidate.note.length > 200))
    || badPackContents(candidate.packContents)
  );
}

function badPackContents(contents: CreateOrderLine['packContents']): boolean {
  if (contents === undefined) return false;
  if (!Array.isArray(contents) || contents.length < 1 || contents.length > 100) return true;
  const slugs = new Set<string>();
  for (const content of contents) {
    if (!content || typeof content.itemSlug !== 'string' || content.itemSlug.length < 1
      || content.itemSlug.length > 100 || !Number.isInteger(content.quantity)
      || content.quantity < 1 || content.quantity > 100 || slugs.has(content.itemSlug)) return true;
    slugs.add(content.itemSlug);
  }
  return false;
}

/** The two values the guards produce that the body itself does not carry. */
export type ValidatedOrderRequest = {
  guestLabel: string | null;
  clientKey: string;
};

export function validateOrderRequest(
  request: Request,
  body: PlaceOrderRequest,
  caller: Caller,
): ValidatedOrderRequest | Response {
  if (typeof body.locationId !== 'string' || body.locationId.length === 0) {
    return jsonError(400, 'invalid_request', 'locationId is required.');
  }
  // A kiosk misconfigured to another store would otherwise book orders at the
  // wrong location with no error at all. Refuse loudly rather than override:
  // silently rewriting the location would hide a mis-paired tablet for weeks.
  if (caller.kind === 'device' && body.locationId !== caller.device.location_id) {
    return jsonError(403, 'location_mismatch', 'This device is paired to a different location.');
  }
  if (!FULFILLMENT_TYPES.has(body.fulfillmentType)) {
    return jsonError(400, 'invalid_request', 'fulfillmentType must be pickup, curbside, catering or delivery.');
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.some(badLine)) {
    return jsonError(400, 'invalid_request', 'lines must name menu items by slug with a quantity.');
  }
  if (typeof body.tipCents !== 'number') {
    return jsonError(400, 'invalid_request', 'tipCents is required (integer cents; 0 for no tip).');
  }
  if ((body.loyaltyRedeemPoints ?? 0) !== 0) {
    return jsonError(400, 'loyalty_redeem_unsupported',
      'Point redemption on an order is not live yet; redeem rewards via /api/loyalty/redeem.');
  }
  if (body.scheduledFor !== undefined && body.scheduledFor !== null && typeof body.scheduledFor !== 'string') {
    return jsonError(400, 'invalid_request', 'scheduledFor must be an ISO timestamp or null.');
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    return jsonError(400, 'invalid_request', 'note must be a string.');
  }
  if (body.maximumTotalCents !== undefined
    && (!Number.isInteger(body.maximumTotalCents) || body.maximumTotalCents < 0)) {
    return jsonError(400, 'invalid_request', 'maximumTotalCents must be non-negative integer cents.');
  }
  // Enforced here rather than trusted from the client: `board_tickets` is
  // granted to `anon` and the pickup display hangs where a whole room reads it,
  // so this column is a broadcast channel and the server is the only thing
  // standing in front of it.
  const parsedGuestLabel = parseGuestLabel(body.guestLabel);
  if (parsedGuestLabel.kind === 'rejected') {
    return jsonError(400, 'invalid_request',
      parsedGuestLabel.reason === 'too-long'
        ? 'guestLabel must be 24 characters or fewer.'
        : 'guestLabel may only contain letters, numbers, spaces and simple punctuation.');
  }
  const guestLabel = parsedGuestLabel.kind === 'ok' ? parsedGuestLabel.label : null;
  const clientKey = idempotencyKeyOf(request);
  if (clientKey === false) {
    return jsonError(400, 'invalid_request', 'Idempotency-Key must be a UUID.');
  }
  if (clientKey === null) {
    return jsonError(428, 'idempotency_key_required', 'Idempotency-Key is required for order placement.');
  }
  if (body.tenderType === 'square_card') {
    return jsonError(503, 'tender_unavailable', 'In-app card payment needs a store build; use square_link or pay_at_pickup.');
  }
  if (!LIVE_TENDERS.has(body.tenderType)) {
    return jsonError(400, 'invalid_request', 'tenderType must be pay_at_pickup or square_link.');
  }
  return { guestLabel, clientKey };
}
