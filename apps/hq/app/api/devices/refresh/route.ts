import { DeviceError, loadDeviceSigningKey, refreshDeviceToken, verifyDeviceToken } from '@platform/engine';

import {
  corsPreflight, jsonError, jsonWithCors, notConfigured, serverEnv, serviceDb,
} from '../../../../lib/api-auth';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/devices/refresh — a fresh token for a device that already has one.
 *
 * Re-reads the row, which is what makes revocation immediate on the path that
 * bypasses RLS: a revoked or re-paired device is refused here rather than
 * running until its current token expires.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) return jsonError(401, 'unauthorized', 'Send the current device token.');

  try {
    const key = loadDeviceSigningKey();
    const claims = verifyDeviceToken(token, key, Date.now());
    if (!claims) return jsonError(401, 'unauthorized', 'That device token is not valid.');
    return jsonWithCors(await refreshDeviceToken({ db, key }, claims), 200);
  } catch (error) {
    if (error instanceof DeviceError) {
      if (error.code === 'not_configured') return jsonError(501, error.code, error.message);
      return jsonError(401, 'unauthorized', 'This device is no longer paired.');
    }
    throw error;
  }
}
