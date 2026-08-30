import { DeviceError, exchangeDeviceRefreshSecret, loadDeviceSigningKey } from '@platform/engine';

import {
  corsPreflight, jsonError, jsonWithCors, notConfigured, parseJsonBody, serverEnv, serviceDb,
} from '../../../../lib/api-auth';
import { clientIdentity, rateLimited } from '../../../../lib/rate-limit';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/devices/exchange — trade a long-lived refresh secret for a token.
 *
 * `/api/devices/refresh` needs a currently valid token, which a screen that has
 * been off overnight no longer has. This is the path back for hardware nobody
 * signs into: the secret is what persists, the token stays twelve hours.
 *
 * Unauthenticated for the same reason `/pair` is — the credential presented IS
 * the authentication — and answers uniformly for the same reason: a caller
 * holding a candidate secret must not learn whether it is unknown, revoked or
 * merely outside its rotation window.
 *
 * Throttled harder than `/pair`: the secret behind this route is long-lived
 * where a pairing code expires in fifteen minutes, so an attacker has as long
 * as they like to spend attempts against it. A screen exchanges once when it
 * wakes, which needs nowhere near five a minute.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();

  if (rateLimited(clientIdentity(request), 'devices/exchange', Date.now(), 5)) {
    return jsonError(429, 'rate_limited', 'Too many device exchanges. Try again shortly.');
  }
  const db = serviceDb(env);

  const body = await parseJsonBody<{ secret?: unknown }>(request);
  if (body instanceof Response) return body;
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (secret.length < 16 || secret.length > 256) {
    return jsonError(400, 'invalid_request', 'secret is required.');
  }

  try {
    const token = await exchangeDeviceRefreshSecret(
      { db, key: loadDeviceSigningKey() },
      { secret },
    );
    return jsonWithCors(token, 200);
  } catch (error) {
    if (error instanceof DeviceError) {
      if (error.code === 'not_configured') {
        return jsonError(501, error.code, error.message);
      }
      return jsonError(400, 'pairing_unknown', 'That device credential is not usable.');
    }
    throw error;
  }
}
