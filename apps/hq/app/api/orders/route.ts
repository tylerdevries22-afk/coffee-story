import type { PlaceOrderRequest, PlaceOrderResponse } from '@platform/api-client';
import {
  createOrder,
  createSquareCheckoutLink,
  OrderError,
  parseTaxJurisdictions,
  type CreateOrderLine,
  type OrderTenderType,
} from '@platform/engine';

import { parseGuestLabel, resolveOrderChannel } from '@platform/domain';

import { squareRuntimeFor, type BrandFeeRow } from '../../../lib/square-runtime';
import { isTenantRedirect, tenantSchemeOf } from '../../../lib/tenant-redirect';

import {
  authenticate,
  corsPreflight,
  idempotencyKeyOf,
  jsonError,
  jsonWithCors,
  notConfigured,
  parseJsonBody,
  resolveCustomer,
  serverEnv,
  serviceDb,
} from '../../../lib/api-auth';

/**
 * POST /api/orders — the one way an order enters the platform. The client
 * sends slugs and a tender; every cent is recomputed server-side from
 * menu_items and the brand's tax config, and the Idempotency-Key becomes
 * orders.client_key so a retried request returns the first order.
 *
 * Tenders: pay_at_pickup always; square_link once the location has a Square
 * connection, answering with a hosted checkout URL the app opens (the
 * webhook, not the browser's return trip, is what marks it paid).
 * square_card needs a native card SDK and waits for store builds; external is
 * POS-side bookkeeping, never a client request.
 */

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
  );
}

const ERROR_STATUS: Record<OrderError['code'], number> = {
  invalid_request: 400,
  quantity_invalid: 400,
  size_required: 400,
  size_unknown: 400,
  modifier_unknown: 400,
  modifier_invalid: 400,
  catalog_invalid: 500,
  location_unknown: 404,
  ordering_paused: 409,
  item_unavailable: 409,
  refund_unavailable: 409,
  cancel_unavailable: 409,
};

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<PlaceOrderRequest>(request);
  if (body instanceof Response) return body;

  if (typeof body.locationId !== 'string' || body.locationId.length === 0) {
    return jsonError(400, 'invalid_request', 'locationId is required.');
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
  if (body.tenderType === 'square_card') {
    return jsonError(503, 'tender_unavailable', 'In-app card payment needs a store build; use square_link or pay_at_pickup.');
  }
  if (!LIVE_TENDERS.has(body.tenderType)) {
    return jsonError(400, 'invalid_request', 'tenderType must be pay_at_pickup or square_link.');
  }

  const brand = await db
    .from('brands')
    .select('id, brand_config, fee_bps, fee_bps_tier2, tier_threshold_cents')
    .eq('id', auth.claims.brand_id)
    .single<{ id: string; brand_config: unknown } & BrandFeeRow>();
  if (brand.error) return jsonError(500, 'internal', 'Could not load the brand.');

  // Checked before the order is written: a card order with nowhere to pay is
  // a row the guest can never settle and the board must never show.
  let square = null;
  if (body.tenderType === 'square_link') {
    try {
      square = await squareRuntimeFor(db, {
        brandId: auth.claims.brand_id,
        locationId: body.locationId,
        brand: brand.data,
      });
    } catch {
      return jsonError(500, 'internal', 'Could not read this location’s payment connection.');
    }
    if (!square) {
      return jsonError(503, 'tender_unavailable', 'Card payments are not connected for this location yet; order with pay_at_pickup.');
    }
    // Square appends the transaction ids to whatever URL it is given, on a
    // page wearing the brand's name, so the destination must be this
    // tenant's own app. Fail closed: a brand that declares no scheme takes
    // no redirect.
    if (body.redirectUrl !== undefined
      && !isTenantRedirect(body.redirectUrl, tenantSchemeOf(brand.data.brand_config))) {
      return jsonError(400, 'invalid_request', 'redirectUrl must be this app’s own deep link.');
    }
  }

  let taxJurisdictions;
  try {
    taxJurisdictions = parseTaxJurisdictions(brand.data.brand_config);
  } catch (error) {
    return jsonError(500, 'config_invalid', error instanceof Error ? error.message : 'Bad tax config.');
  }

  const customer = await resolveCustomer(db, auth);

  try {
    const result = await createOrder({ db }, {
      brandId: auth.claims.brand_id,
      locationId: body.locationId,
      customerId: customer.id,
      actorUserId: auth.userId,
      fulfillmentType: body.fulfillmentType,
      scheduledFor: body.scheduledFor ?? null,
      note: body.note ?? '',
      lines: body.lines,
      tipCents: body.tipCents,
      tenderType: body.tenderType,
      // From the caller, never from the body: a client that could name its own
      // channel could dress a web order up as in-app and flatter the brand's
      // dashboard. `resolveOrderChannel` is tested and takes a device role, so
      // a paired kiosk attributes correctly the moment pairing lands -- the
      // ternary this replaces could not emit 'kiosk' at all.
      channel: resolveOrderChannel({ staffRole: auth.claims.role }),
      guestLabel,
      clientKey,
      taxJurisdictions,
    });
    const response: PlaceOrderResponse = {
      orderId: result.orderId,
      status: result.status as PlaceOrderResponse['status'],
      subtotalCents: result.subtotalCents,
      taxCents: result.taxCents,
      tipCents: result.tipCents,
      totalCents: result.totalCents,
      dailyNumber: result.dailyNumber,
    };

    if (square) {
      // The order exists and is priced; this only mints the page to pay on.
      // A replayed request finds the link already stored and returns it, so
      // one cart never yields two checkout pages.
      const link = await createSquareCheckoutLink(
        { db, ...square },
        {
          orderId: result.orderId,
          ...(body.redirectUrl ? { redirectUrl: body.redirectUrl } : {}),
          ...(auth.email ? { buyerEmail: auth.email } : {}),
        },
      );
      response.checkoutUrl = link.checkoutUrl;
    }
    return jsonWithCors(response, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof OrderError) {
      return jsonError(ERROR_STATUS[error.code], error.code, error.message);
    }
    throw error;
  }
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
