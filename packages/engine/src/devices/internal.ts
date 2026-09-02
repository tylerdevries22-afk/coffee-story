/**
 * Row columns and token minting shared by the device modules. Nothing here
 * is public API: devices.ts re-exports only the modules' public surface.
 */
import { DEVICE_TOKEN_TTL_SECONDS, signDeviceToken } from './tokens';

import type { DeviceClaims, DeviceRowLike, DeviceSigningKey, DeviceToken } from './types';

/**
 * Columns are named, never `select('*')`.
 *
 * A sibling change added column-level revokes on other tables, and a `*` there
 * now ERRORS rather than returning a redacted row. Naming columns is also the
 * only way this keeps working when a column is later restricted.
 */
export const DEVICE_COLUMNS =
  'id, brand_id, location_id, role, label, pairing_code_hash, pairing_expires_at, paired_at, revoked_at, last_seen_at, token_version, created_at, updated_at';

export const DEVICE_REFRESH_COLUMNS = `${DEVICE_COLUMNS}, refresh_secret_hash, refresh_secret_issued_at, refresh_secret_previous_hash, refresh_secret_previous_expires_at, refresh_secret_last_used_at`;

export function tokenFor(device: DeviceRowLike, key: DeviceSigningKey, nowMs: number): DeviceToken {
  const claims: DeviceClaims = {
    brandId: device.brand_id,
    deviceId: device.id,
    locationId: device.location_id,
    role: device.role,
    tokenVersion: device.token_version,
  };
  return {
    token: signDeviceToken(claims, key, nowMs),
    expiresAt: new Date(nowMs + DEVICE_TOKEN_TTL_SECONDS * 1000).toISOString(),
    deviceId: device.id,
    role: device.role,
    brandId: device.brand_id,
    locationId: device.location_id,
    label: device.label,
  };
}
