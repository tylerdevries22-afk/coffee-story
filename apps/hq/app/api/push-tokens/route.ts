import type { RegisterPushTokenRequest } from '@platform/api-client';

import {
  corsPreflight,
  jsonWithCors,
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

  // Re-homing is deliberate WITHIN a brand — one device, a guest signs out
  // and a friend signs in, notifications must follow. Across brands it is
  // not: an Expo push token is a device identifier, not a secret, and
  // conflicting on the token alone let anyone holding one move another
  // tenant's device onto their own account and take its notifications.
  const existing = await db
    .from('push_tokens')
    .select('brand_id')
    .eq('token', body.token)
    .maybeSingle<{ brand_id: string }>();
  if (existing.error) throw existing.error;
  if (existing.data && existing.data.brand_id !== auth.claims.brand_id) {
    return jsonError(409, 'token_registered_elsewhere',
      'That device is registered to another shop. Sign out of it there first.');
  }

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

  return jsonWithCors({ ok: true });
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
