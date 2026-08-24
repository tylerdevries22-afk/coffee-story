import { canManageLocation, type DeviceRole } from '@platform/schema';
import { DeviceError, issuePairingCode, loadDeviceSigningKey } from '@platform/engine';

import {
  authenticate, corsPreflight, jsonError, jsonWithCors, notConfigured,
  parseJsonBody, serverEnv, serviceDb,
} from '../../../lib/api-auth';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

const PAIRABLE: readonly DeviceRole[] = ['kiosk', 'pos', 'display', 'prep'];

/**
 * POST /api/devices — mint a pairing code for a screen.
 *
 * Staff only, and scoped to a location the caller actually manages. The code
 * comes back ONCE: only its HMAC is stored, because `devices_select` is
 * brand-wide and includes `role = 'staff'`, so a readable code would let any
 * barista pair hardware at any of the brand's stores.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  if (!auth.claims.role) {
    return jsonError(403, 'forbidden', 'Only staff can pair a device.');
  }

  const body = await parseJsonBody<{ locationId?: unknown; role?: unknown; label?: unknown }>(request);
  if (body instanceof Response) return body;

  const locationId = typeof body.locationId === 'string' ? body.locationId : '';
  const role = body.role;
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!locationId) return jsonError(400, 'invalid_request', 'locationId is required.');
  if (typeof role !== 'string' || !PAIRABLE.includes(role as DeviceRole)) {
    return jsonError(400, 'invalid_request', 'role must be kiosk, pos, display or prep.');
  }
  if (label.length === 0 || label.length > 60) {
    return jsonError(400, 'invalid_request', 'label must be 1-60 characters.');
  }
  // A location_manager pairs the tablet at their own store, not at another.
  if (!canManageLocation(auth.claims, locationId)) {
    return jsonError(403, 'forbidden', 'You do not manage that location.');
  }

  try {
    const invite = await issuePairingCode(
      { db, key: loadDeviceSigningKey() },
      { brandId: auth.claims.brand_id, locationId, role: role as DeviceRole, label },
    );
    return jsonWithCors(invite, 201);
  } catch (error) {
    if (error instanceof DeviceError) {
      return jsonError(error.code === 'not_configured' ? 501 : 400, error.code, error.message);
    }
    throw error;
  }
}
