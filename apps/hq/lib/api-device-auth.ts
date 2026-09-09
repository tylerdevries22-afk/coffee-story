import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadActiveDevice, loadDeviceSigningKey, verifyDeviceToken,
  type DeviceClaims, type DeviceRowLike, type DeviceSigningKey,
} from '@platform/engine';

import { authenticate, jsonError } from './api-auth';
import type { AuthedRequest } from './api-auth';

export type Caller =
  | ({ kind: 'user' } & AuthedRequest)
  | { kind: 'device'; device: DeviceRowLike; claims: DeviceClaims };

export async function authenticateAny(
  request: Request,
  db: SupabaseClient,
): Promise<Caller | Response> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) return jsonError(401, 'unauthorized', 'Send an access token as a Bearer token.');

  // The device path is tried first, but it can only match a token that carries
  // a device_id AND no `sub` -- `verifyDeviceToken` enforces both. That matters
  // because a GoTrue staff token is also HS256 with the same project secret, so
  // a signature check alone does not tell the two issuers apart.
  let key: DeviceSigningKey | null = null;
  try {
    key = loadDeviceSigningKey();
  } catch {
    // Device pairing is not configured on this deployment; fall through to the
    // user path rather than failing a request that never needed it.
    key = null;
  }
  if (key) {
    const claims = verifyDeviceToken(token, key, Date.now());
    if (claims) {
      // Re-read the row. This is the ONLY check on the service-role path, where
      // RLS does not apply -- without it a revoked kiosk keeps ringing sales
      // for the remaining life of its token.
      const device = await loadActiveDevice({ db, key }, claims);
      if (!device) {
        return jsonError(401, 'unauthorized', 'This device is no longer paired.');
      }
      return { kind: 'device', device, claims };
    }
  }

  const user = await authenticate(request, db);
  if (user instanceof Response) return user;
  return { kind: 'user', ...user };
}
