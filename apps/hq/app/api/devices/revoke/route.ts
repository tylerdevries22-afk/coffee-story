import { loadDeviceSigningKey } from '@platform/engine';

import { deviceAdminStatus, revokePairedDevice } from '../../../../lib/device-admin';
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
 *
 * Gated on the device's location, not merely on holding a role -- see
 * lib/device-admin for why that changed.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<{ deviceId?: unknown }>(request);
  if (body instanceof Response) return body;

  try {
    await revokePairedDevice(
      { db, loadKey: loadDeviceSigningKey },
      auth.claims,
      typeof body.deviceId === 'string' ? body.deviceId : '',
    );
    return jsonWithCors({ revoked: true }, 200);
  } catch (error) {
    const answer = deviceAdminStatus(error);
    if (answer) return jsonError(answer.status, answer.code, answer.message);
    throw error;
  }
}
