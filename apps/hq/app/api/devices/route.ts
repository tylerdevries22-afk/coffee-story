import { loadDeviceSigningKey } from '@platform/engine';

import { deviceAdminStatus, pairDevice } from '../../../lib/device-admin';
import {
  authenticate, corsPreflight, jsonError, jsonWithCors, notConfigured,
  parseJsonBody, serverEnv, serviceDb,
} from '../../../lib/api-auth';

export const dynamic = 'force-dynamic';
export function OPTIONS() { return corsPreflight(); }

/**
 * POST /api/devices — mint a pairing code for a screen.
 *
 * Staff only, and scoped to a location the caller actually manages. The code
 * comes back ONCE: only its HMAC is stored, because `devices_select` is
 * brand-wide and includes `role = 'staff'`, so a readable code would let any
 * barista pair hardware at any of the brand's stores.
 *
 * Who may do this lives in lib/device-admin, shared with the console action
 * and tested there.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);

  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<{ locationId?: unknown; role?: unknown; label?: unknown }>(request);
  if (body instanceof Response) return body;

  try {
    const invite = await pairDevice({ db, loadKey: loadDeviceSigningKey }, auth.claims, {
      locationId: typeof body.locationId === 'string' ? body.locationId : '',
      role: typeof body.role === 'string' ? body.role : '',
      label: typeof body.label === 'string' ? body.label : '',
    });
    return jsonWithCors(invite, 201);
  } catch (error) {
    const answer = deviceAdminStatus(error);
    if (answer) return jsonError(answer.status, answer.code, answer.message);
    throw error;
  }
}
