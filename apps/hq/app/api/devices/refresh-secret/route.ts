import { loadDeviceSigningKey } from '@platform/engine';

import { deviceAdminStatus, issueRefreshSecret } from '../../../../lib/device-admin';
import {
  authenticate, corsPreflight, jsonError, jsonWithCors, notConfigured,
  parseJsonBody, serverEnv, serviceDb,
} from '../../../../lib/api-auth';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/devices/refresh-secret — mint the durable credential for a screen.
 *
 * A display is hardware nobody signs into, so its twelve-hour token has to be
 * derived from something that outlives a deploy. This returns that something
 * ONCE: only its HMAC is stored, for the reason `POST /api/devices` documents.
 *
 * Rotating is the same call. The outgoing secret keeps working for an overlap
 * window, so a screen mid-render when an operator rotates does not go dark
 * waiting to be handed the new one.
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
    const issued = await issueRefreshSecret(
      { db, loadKey: loadDeviceSigningKey },
      auth.claims,
      typeof body.deviceId === 'string' ? body.deviceId : '',
    );
    return jsonWithCors(issued, 201);
  } catch (error) {
    const answer = deviceAdminStatus(error);
    if (answer) return jsonError(answer.status, answer.code, answer.message);
    throw error;
  }
}
