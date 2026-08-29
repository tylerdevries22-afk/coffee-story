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
import { canManageLocation, type DeviceRole, type TenantClaims } from '@platform/schema';
import {
  DeviceError,
  issueDeviceRefreshSecret,
  issuePairingCode,
  revokeDevice,
  type DeviceDeps,
  type DeviceRefreshSecret,
  type PairingInvite,
} from '@platform/engine';

/** Roles a physical screen can be paired as. A person's role is not one of these. */
export const PAIRABLE_ROLES: readonly DeviceRole[] = ['kiosk', 'pos', 'display', 'prep'];

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
  deps: Pick<DeviceDeps, 'db'>,
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
  deps: DeviceDeps,
  claims: TenantClaims,
  input: { locationId: string; role: string; label: string },
): Promise<PairingInvite> {
  assertStaff(claims);
  const label = input.label.trim();
  if (!input.locationId) throw new DeviceAdminError('invalid_request', 'locationId is required.');
  if (!PAIRABLE_ROLES.includes(input.role as DeviceRole)) {
    throw new DeviceAdminError('invalid_request', 'role must be kiosk, pos, display or prep.');
  }
  if (label.length === 0 || label.length > LABEL_MAX) {
    throw new DeviceAdminError('invalid_request', `label must be 1-${LABEL_MAX} characters.`);
  }
  // A location_manager pairs the tablet at their own store, not at another.
  if (!canManageLocation(claims, input.locationId)) {
    throw new DeviceAdminError('forbidden', 'You do not manage that location.');
  }
  return issuePairingCode(deps, {
    brandId: claims.brand_id,
    locationId: input.locationId,
    role: input.role as DeviceRole,
    label,
  });
}

export async function issueRefreshSecret(
  deps: DeviceDeps,
  claims: TenantClaims,
  deviceId: string,
): Promise<DeviceRefreshSecret> {
  await locationOfManagedDevice(deps, claims, deviceId);
  return issueDeviceRefreshSecret(deps, { brandId: claims.brand_id, deviceId });
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
  deps: DeviceDeps,
  claims: TenantClaims,
  deviceId: string,
): Promise<void> {
  await locationOfManagedDevice(deps, claims, deviceId);
  await revokeDevice(deps, { brandId: claims.brand_id, deviceId });
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
