import { DeviceError, loadDeviceSigningKey, revokeDevice } from '@platform/engine';

import {
  authenticate, corsPreflight, jsonError, jsonWithCors, notConfigured,
  parseJsonBody, serverEnv, serviceDb,
} from '../../../../lib/api-auth';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/devices/revoke — stop a screen, now.
 *
 * Revocation has to bite on both paths. RLS sees it immediately because
 * `app.device_is_active` re-reads the row; the service-role path sees it
 * because the engine zeroes `token_version`, and every request compares the
 * version in the token against the row. A stolen tablet stops working on the
 * next request rather than at the end of the shift.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  if (!auth.claims.role) return jsonError(403, 'forbidden', 'Only staff can revoke a device.');

  const body = await parseJsonBody<{ deviceId?: unknown }>(request);
  if (body instanceof Response) return body;
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!deviceId) return jsonError(400, 'invalid_request', 'deviceId is required.');

  try {
    // Scoped to the caller's brand, so a token from one tenant cannot revoke
    // another tenant's hardware even with a correct device id.
    await revokeDevice({ db, key: loadDeviceSigningKey() }, { brandId: auth.claims.brand_id, deviceId });
    return jsonWithCors({ revoked: true }, 200);
  } catch (error) {
    if (error instanceof DeviceError) {
      return jsonError(error.code === 'not_configured' ? 501 : 400, error.code, error.message);
    }
    throw error;
  }
}
