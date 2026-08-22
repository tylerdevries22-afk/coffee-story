import type { RegisterPushTokenRequest } from '@platform/api-client';

import {
  authenticate,
  jsonError,
  notConfigured,
  parseJsonBody,
  resolveCustomer,
  serverEnv,
  serviceDb,
} from '../../../lib/api-auth';

/**
 * POST /api/push-tokens — register (or re-home) one device's push token.
 * Tokens are UNIQUE across the table: a device that signs into a different
 * account carries its token along, so the upsert re-points customer_id
 * instead of failing.
 */

const PLATFORMS = new Set(['ios', 'android', 'web', 'unknown']);
const MAX_TOKEN_LENGTH = 400;

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<RegisterPushTokenRequest>(request);
  if (body instanceof Response) return body;
  if (typeof body.token !== 'string' || body.token.length === 0 || body.token.length > MAX_TOKEN_LENGTH) {
    return jsonError(400, 'invalid_request', 'token is required.');
  }
  if (!PLATFORMS.has(body.platform)) {
    return jsonError(400, 'invalid_request', 'platform must be ios, android, web or unknown.');
  }

  const customer = await resolveCustomer(db, auth);
  const upserted = await db.from('push_tokens').upsert(
    {
      brand_id: auth.claims.brand_id,
      customer_id: customer.id,
      token: body.token,
      platform: body.platform,
    },
    { onConflict: 'token' },
  );
  if (upserted.error) throw upserted.error;

  return Response.json({ ok: true });
}
