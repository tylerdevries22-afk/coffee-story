import { OrderError, refundOrderPayment } from '@platform/engine';
import { canManageLocation } from '@platform/schema';

import {
  authenticate,
  corsPreflight,
  idempotencyKeyOf,
  jsonError,
  jsonWithCors,
  notConfigured,
  parseJsonBody,
  serverEnv,
  serviceDb,
} from '../../../../lib/api-auth';
import { squareRuntimeFor, type BrandFeeRow } from '../../../../lib/square-runtime';

/**
 * POST /api/orders/refund — staff only, the one way money goes back.
 *
 * Every other order transition is a direct order_events insert under RLS (the
 * DB trigger is the state machine), but a refund moves real money at Square
 * first: it needs the location's decrypted token, which no client may ever
 * hold. So the refunded event is written here, server-side, only after Square
 * has actually returned the funds.
 */

type RefundBody = {
  orderId?: unknown;
  amountCents?: unknown;
  reason?: unknown;
};

const STAFF_ROLES = new Set(['platform_admin', 'brand_owner', 'location_manager', 'staff']);

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  if (!auth.claims.role || !STAFF_ROLES.has(auth.claims.role)) {
    return jsonError(403, 'forbidden', 'Only staff can refund an order.');
  }

  const body = await parseJsonBody<RefundBody>(request);
  if (body instanceof Response) return body;

  if (typeof body.orderId !== 'string' || body.orderId.length === 0) {
    return jsonError(400, 'invalid_request', 'orderId is required.');
  }
  const amountCents = body.amountCents === undefined || body.amountCents === 'full'
    ? 'full' as const
    : body.amountCents;
  if (amountCents !== 'full' && (typeof amountCents !== 'number' || !Number.isInteger(amountCents))) {
    return jsonError(400, 'invalid_request', 'amountCents must be whole cents, or "full".');
  }
  const requestKey = idempotencyKeyOf(request);
  if (!requestKey) {
    return jsonError(400, 'invalid_request', 'A UUID Idempotency-Key is required for every refund attempt.');
  }
  const reason = typeof body.reason === 'string' && body.reason.length > 0
    ? body.reason.slice(0, 190)
    : 'Refunded by staff';

  // The order must be this brand's, and — for a location-scoped role — one of
  // the locations this staff member actually works.
  const order = await db
    .from('orders')
    .select('id, brand_id, location_id')
    .eq('id', body.orderId)
    .eq('brand_id', auth.claims.brand_id)
    .maybeSingle<{ id: string; brand_id: string; location_id: string }>();
  if (order.error) return jsonError(500, 'internal', 'Could not load that order.');
  if (!order.data) return jsonError(404, 'not_found', 'That order does not exist.');
  // The shared claims helper, not a hand-rolled check: the previous one asked
  // only about the 'staff' role, so a location_manager could refund any store
  // in the brand — and it skipped the check entirely when location_ids was
  // empty, which is the column's default, so a staff account with no
  // locations had brand-wide authority over refunds.
  if (!canManageLocation(auth.claims, order.data.location_id)) {
    return jsonError(403, 'forbidden', 'That order belongs to another location.');
  }

  const brand = await db
    .from('brands')
    .select('fee_bps, fee_bps_tier2, tier_threshold_cents')
    .eq('id', auth.claims.brand_id)
    .single<BrandFeeRow>();
  if (brand.error) return jsonError(500, 'internal', 'Could not load the brand.');

  const square = await squareRuntimeFor(db, {
    brandId: auth.claims.brand_id,
    locationId: order.data.location_id,
    brand: brand.data,
  });
  if (!square) {
    return jsonError(503, 'refund_unavailable',
      'Card payments are not connected for this location, so there is nothing to return here — refund at the register.');
  }

  try {
    const result = await refundOrderPayment(
      { db, square: square.square, locationAccessToken: square.locationAccessToken },
      {
        orderId: order.data.id,
        amountCents,
        reason,
        actorUserId: auth.userId,
        // Identifies this attempt to Square: a retry after a lost response
        // returns the first refund rather than sending the money again. A
        // caller must retain this across every retry until the outcome is known.
        requestKey,
      },
    );
    return jsonWithCors(result, 200);
  } catch (error) {
    if (error instanceof OrderError) {
      return jsonError(error.code === 'refund_unavailable' ? 409 : 400, error.code, error.message);
    }
    throw error;
  }
}

/** Browser preflight for the operator web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
