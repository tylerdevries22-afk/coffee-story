import type { PlaceOrderRequest, PlaceOrderResponse } from '@platform/api-client';
import {
  createOrder,
  createSquareCheckoutLink,
  OrderError,
} from '@platform/engine';

import { resolveOrderChannel } from '@platform/domain';
import { canPlaceOrders } from '@platform/engine';

import { orderErrorResponse, placeOrderResponseOf } from '../../../lib/order-outcome';
import { validateOrderRequest } from '../../../lib/order-request';
import { resolveOrderTender } from '../../../lib/order-tender';

import {
  authenticateAny,
  corsPreflight,
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
 *
 * Split by concern, in the order the handler runs them: the body guards live
 * in lib/order-request, the brand read behind tender and tax in
 * lib/order-tender, and the response and error statuses in lib/order-outcome.
 */

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const caller = await authenticateAny(request, db);
  if (caller instanceof Response) return caller;

  // A display or a prep tablet must never ring a sale. `postureFor` says so in
  // the app; the server says it too rather than trusting the app to.
  if (caller.kind === 'device' && !canPlaceOrders(caller.device.role)) {
    return jsonError(403, 'device_role_unsupported', 'This device may not place orders.');
  }
  const callerBrandId = caller.kind === 'device' ? caller.device.brand_id : caller.claims.brand_id;
  const callerStaffRole = caller.kind === 'user' ? caller.claims.role ?? null : null;
  const callerUserId = caller.kind === 'user' ? caller.userId : null;

  const body = await parseJsonBody<PlaceOrderRequest>(request);
  if (body instanceof Response) return body;

  const validated = validateOrderRequest(request, body, caller);
  if (validated instanceof Response) return validated;
  const { guestLabel, clientKey } = validated;

  const tender = await resolveOrderTender(db, { brandId: callerBrandId, body });
  if (tender instanceof Response) return tender;
  const { square, taxJurisdictions } = tender;

  // A device has no auth user behind it, so it has no customer and no actor.
  // `orders.customer_id` is nullable (0005) and the loyalty earn already
  // short-circuits on null, so an anonymous kiosk sale is a first-class case
  // rather than a hole to paper over.
  const customer = caller.kind === 'user' ? await resolveCustomer(db, caller) : null;

  try {
    const result = await createOrder({ db }, {
      brandId: callerBrandId,
      locationId: body.locationId,
      customerId: customer?.id ?? null,
      actorUserId: callerUserId,
      deviceId: caller.kind === 'device' ? caller.device.id : null,
      fulfillmentType: body.fulfillmentType,
      scheduledFor: body.scheduledFor ?? null,
      note: body.note ?? '',
      lines: body.lines,
      tipCents: body.tipCents,
      maximumTotalCents: body.maximumTotalCents,
      tenderType: body.tenderType,
      // From the caller, never from the body: a client that could name its own
      // channel could dress a web order up as in-app and flatter the brand's
      // dashboard. `resolveOrderChannel` is tested and takes a device role, so
      // a paired kiosk attributes correctly the moment pairing lands -- the
      // ternary this replaces could not emit 'kiosk' at all.
      channel: resolveOrderChannel({
        deviceRole: caller.kind === 'device' ? caller.device.role : null,
        staffRole: callerStaffRole,
      }),
      guestLabel,
      clientKey,
      taxJurisdictions,
    });
    const response: PlaceOrderResponse = placeOrderResponseOf(result);

    if (square) {
      // The order exists and is priced; this only mints the page to pay on.
      // A replayed request finds the link already stored and returns it, so
      // one cart never yields two checkout pages.
      const link = await createSquareCheckoutLink(
        { db, ...square },
        {
          orderId: result.orderId,
          ...(body.redirectUrl ? { redirectUrl: body.redirectUrl } : {}),
          ...(caller.kind === 'user' && caller.email ? { buyerEmail: caller.email } : {}),
        },
      );
      response.checkoutUrl = link.checkoutUrl;
    }
    return jsonWithCors(response, result.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof OrderError) {
      return orderErrorResponse(error);
    }
    throw error;
  }
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
