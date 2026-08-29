import { canManageLocation } from '@platform/schema';
import { DeviceError, issueDeviceRefreshSecret, loadDeviceSigningKey } from '@platform/engine';

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
  if (!auth.claims.role) {
    return jsonError(403, 'forbidden', 'Only staff can issue a device credential.');
  }

  const body = await parseJsonBody<{ deviceId?: unknown }>(request);
  if (body instanceof Response) return body;
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!deviceId) return jsonError(400, 'invalid_request', 'deviceId is required.');

  // The engine scopes by brand. The location check is here because a
  // location_manager who may pair a screen at their own store must not be able
  // to mint a durable credential for one at another of the brand's stores.
  const device = await db
    .from('devices')
    .select('location_id')
    .eq('id', deviceId)
    .eq('brand_id', auth.claims.brand_id)
    .maybeSingle();
  if (device.error) return jsonError(400, 'invalid_request', device.error.message);
  const locationId = device.data?.location_id;
  if (typeof locationId !== 'string' || !canManageLocation(auth.claims, locationId)) {
    // One answer for "not yours" and "not there", so device ids stay unprobeable.
    return jsonError(403, 'forbidden', 'You do not manage that device.');
  }

  try {
    const issued = await issueDeviceRefreshSecret(
      { db, key: loadDeviceSigningKey() },
      { brandId: auth.claims.brand_id, deviceId },
    );
    return jsonWithCors(issued, 201);
  } catch (error) {
    if (error instanceof DeviceError) {
      return jsonError(error.code === 'not_configured' ? 501 : 400, error.code, error.message);
    }
    throw error;
  }
}
