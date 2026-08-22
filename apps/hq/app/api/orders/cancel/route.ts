import { cancelOrder, OrderError } from '@platform/engine';

import {
  authenticate,
  corsPreflight,
  jsonError,
  jsonWithCors,
  notConfigured,
  parseJsonBody,
  resolveCustomer,
  serverEnv,
  serviceDb,
} from '../../../../lib/api-auth';

/**
 * POST /api/orders/cancel — a guest calling off their own order.
 *
 * Server-side because RLS deliberately lets only location staff insert an
 * order_event: the client cannot be trusted to move order state. The guest's
 * own customer row is resolved from their verified token, and the order must
 * belong to it, so an orderId from someone else's receipt cancels nothing.
 */

type CancelBody = {
  orderId?: unknown;
  reason?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<CancelBody>(request);
  if (body instanceof Response) return body;
  if (typeof body.orderId !== 'string' || body.orderId.length === 0) {
    return jsonError(400, 'invalid_request', 'orderId is required.');
  }
  const reason = typeof body.reason === 'string' && body.reason.length > 0
    ? body.reason.slice(0, 190)
    : 'Cancelled by the guest';

  const customer = await resolveCustomer(db, auth);
  try {
    const result = await cancelOrder({ db }, {
      orderId: body.orderId,
      customerId: customer.id,
      actorUserId: auth.userId,
      reason,
    });
    return jsonWithCors(result, 200);
  } catch (error) {
    if (error instanceof OrderError) {
      return jsonError(
        error.code === 'cancel_unavailable' ? 409 : 404,
        error.code,
        error.message,
      );
    }
    throw error;
  }
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
