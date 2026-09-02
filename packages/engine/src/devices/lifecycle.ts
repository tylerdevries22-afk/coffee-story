/**
 * A paired device's lifecycle: token refresh, revocation, and the row check
 * behind every service-role request.
 */
import { DEVICE_COLUMNS, tokenFor } from './internal';
import {
  DeviceError,
  type DeviceClaims,
  type DeviceDeps,
  type DeviceRowLike,
  type DeviceToken,
} from './types';

/**
 * A fresh token for a device that already has one.
 *
 * Re-reads the row every time, which is what makes revocation immediate on the
 * service-role path: a revoked or re-paired device gets refused here rather
 * than running until its current token expires.
 */
export async function refreshDeviceToken(deps: DeviceDeps, claims: DeviceClaims): Promise<DeviceToken> {
  const nowMs = deps.now?.() ?? Date.now();
  const device = await loadActiveDevice(deps, claims);
  if (!device) throw new DeviceError('device_revoked', 'This device is no longer paired.');
  const heartbeat = await deps.db.from('devices')
    .update({ last_seen_at: new Date(nowMs).toISOString() })
    .eq('id', device.id);
  if (heartbeat.error) throw new DeviceError('invalid_request', heartbeat.error.message);
  return tokenFor(device, deps.key, nowMs);
}

export async function revokeDevice(
  deps: DeviceDeps,
  input: { brandId: string; deviceId: string },
): Promise<void> {
  const nowMs = deps.now?.() ?? Date.now();
  const { error } = await deps.db
    .from('devices')
    .update({
      revoked_at: new Date(nowMs).toISOString(),
      pairing_code_hash: null,
      pairing_expires_at: null,
      // A revoked screen must not be able to mint itself a replacement from a
      // secret it still holds. `app.clear_revoked_device_secrets` enforces the
      // same thing in the database, so a future writer cannot miss it.
      refresh_secret_hash: null,
      refresh_secret_previous_hash: null,
      refresh_secret_previous_expires_at: null,
      // Bumping the version is what stops an outstanding token, since the API
      // path bypasses RLS and would otherwise honour it until expiry.
      token_version: 0,
    })
    .eq('id', input.deviceId)
    .eq('brand_id', input.brandId);
  if (error) throw new DeviceError('invalid_request', error.message);
}

/**
 * The row behind a claim, or null.
 *
 * The ONLY check on the service-role path, where RLS does not apply. Every
 * field is compared rather than trusted: a token is a statement about the past,
 * and the row is the present.
 */
export async function loadActiveDevice(
  deps: DeviceDeps,
  claims: DeviceClaims,
): Promise<DeviceRowLike | null> {
  const { data, error } = await deps.db
    .from('devices')
    .select(DEVICE_COLUMNS)
    .eq('id', claims.deviceId)
    .maybeSingle();
  if (error) throw new DeviceError('invalid_request', error.message);
  const device = data as DeviceRowLike | null;
  if (!device) return null;
  if (device.revoked_at !== null) return null;
  if (device.paired_at === null) return null;
  if (device.token_version !== claims.tokenVersion) return null;
  if (device.brand_id !== claims.brandId) return null;
  if (device.location_id !== claims.locationId) return null;
  if (device.role !== claims.role) return null;
  return device;
}
