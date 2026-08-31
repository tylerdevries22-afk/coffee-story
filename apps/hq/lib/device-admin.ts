/**
 * The authorization around device administration, in one place.
 *
 * Three routes and three console actions do the same three things to a screen,
 * and the interesting part of each is not the engine call -- it is the check
 * before it. The engine scopes every write by brand, which stops one tenant
 * touching another's hardware, but it cannot know that a location_manager is
 * trusted at their own store and nowhere else. That check lived inline in the
 * route handlers, where the app's test glob (`lib/**\/*.test.ts`) does not
 * reach it.
 *
 * So it lives here instead: one implementation, callable from a route handler
 * and from a server action, and tested.
 */
import { canManageLocation, DEVICE_ROLES, type DeviceRole, type TenantClaims } from '@platform/schema';
import {
  DeviceError,
  issueDeviceRefreshSecret,
  issuePairingCode,
  revokeDevice,
  type DeviceRefreshSecret,
  type DeviceSigningKey,
  type PairingInvite,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The signing key arrives as a thunk, not a value, so that authorization is
 * decided before configuration is consulted.
 *
 * Loaded eagerly, a caller who may not touch a device got 501 "not configured"
 * on a deployment missing its JWT secret instead of the 403 they had earned --
 * and an answer that depends on deployment state is an answer that changes
 * when the deployment is fixed.
 */
export type DeviceAdminDeps = { db: SupabaseClient; loadKey: () => DeviceSigningKey };

const LABEL_MAX = 60;

export class DeviceAdminError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_request', message: string) {
    super(message);
    this.name = 'DeviceAdminError';
  }
}

function assertStaff(claims: TenantClaims): void {
  // A guest carries a brand but no role. Everything here is staff-only.
  if (!claims.role) throw new DeviceAdminError('forbidden', 'Only staff can administer a device.');
}

/**
 * Resolves a device id to the location it stands in, refusing if the caller
 * does not manage that location.
 *
 * One answer for "not yours", "not there" and "not in your brand", so device
 * ids stay unprobeable: a caller must not be able to tell an id that exists
 * elsewhere from one that does not exist at all.
 */
export async function locationOfManagedDevice(
  deps: Pick<DeviceAdminDeps, 'db'>,
  claims: TenantClaims,
  deviceId: string,
): Promise<string> {
  assertStaff(claims);
  if (!deviceId) throw new DeviceAdminError('invalid_request', 'deviceId is required.');

  const found = await deps.db
    .from('devices')
    .select('location_id')
    .eq('id', deviceId)
    .eq('brand_id', claims.brand_id)
    .maybeSingle();
  if (found.error) throw new DeviceAdminError('invalid_request', found.error.message);

  const locationId = (found.data as { location_id?: unknown } | null)?.location_id;
  if (typeof locationId !== 'string' || !canManageLocation(claims, locationId)) {
    throw new DeviceAdminError('forbidden', 'You do not manage that device.');
  }
  return locationId;
}

export async function pairDevice(
  deps: DeviceAdminDeps,
  claims: TenantClaims,
  input: { locationId: string; role: string; label: string },
): Promise<PairingInvite> {
  assertStaff(claims);
  const label = input.label.trim();
  if (!input.locationId) throw new DeviceAdminError('invalid_request', 'locationId is required.');
  if (!DEVICE_ROLES.includes(input.role as DeviceRole)) {
    throw new DeviceAdminError('invalid_request', 'role must be kiosk, pos, display or prep.');
  }
  if (label.length === 0 || label.length > LABEL_MAX) {
    throw new DeviceAdminError('invalid_request', `label must be 1-${LABEL_MAX} characters.`);
  }
  // A location_manager pairs the tablet at their own store, not at another.
  if (!canManageLocation(claims, input.locationId)) {
    throw new DeviceAdminError('forbidden', 'You do not manage that location.');
  }
  // Platform admins manage every location by role, so role authorization is
  // not enough to bind a service-role insert to the JWT's home tenant. Verify
  // ownership before minting a token or writing a device row.
  const location = await deps.db.from('locations').select('id')
    .eq('id', input.locationId).eq('brand_id', claims.brand_id)
    .maybeSingle<{ id: string }>();
  if (location.error) throw new DeviceAdminError('invalid_request', location.error.message);
  if (!location.data) {
    throw new DeviceAdminError('forbidden', 'You do not manage that location.');
  }
  return issuePairingCode({ db: deps.db, key: deps.loadKey() }, {
    brandId: claims.brand_id,
    locationId: input.locationId,
    role: input.role as DeviceRole,
    label,
  });
}

export async function issueRefreshSecret(
  deps: DeviceAdminDeps,
  claims: TenantClaims,
  deviceId: string,
): Promise<DeviceRefreshSecret> {
  await locationOfManagedDevice(deps, claims, deviceId);
  return issueDeviceRefreshSecret(
    { db: deps.db, key: deps.loadKey() },
    { brandId: claims.brand_id, deviceId },
  );
}

/**
 * Revocation is gated on the location, not merely on holding a staff role.
 *
 * It did not used to be: pairing and secret issuance both checked
 * canManageLocation while revoke checked only that the caller had some role,
 * which let a barista at one store stop the pickup display at another. That is
 * a denial of service against a screen on a wall, and there is no workflow
 * that wants it -- a brand_owner still passes canManageLocation everywhere, so
 * the only callers who lose anything are the ones who should never have had it.
 */
export async function revokePairedDevice(
  deps: DeviceAdminDeps,
  claims: TenantClaims,
  deviceId: string,
): Promise<void> {
  await locationOfManagedDevice(deps, claims, deviceId);
  await revokeDevice({ db: deps.db, key: deps.loadKey() }, { brandId: claims.brand_id, deviceId });
}

/** Maps an engine or admin failure onto the status the API surface should answer. */
export function deviceAdminStatus(error: unknown): { status: number; code: string; message: string } | null {
  if (error instanceof DeviceAdminError) {
    return { status: error.code === 'forbidden' ? 403 : 400, code: error.code, message: error.message };
  }
  if (error instanceof DeviceError) {
    return {
      status: error.code === 'not_configured' ? 501 : 400,
      code: error.code,
      message: error.message,
    };
  }
  return null;
}
