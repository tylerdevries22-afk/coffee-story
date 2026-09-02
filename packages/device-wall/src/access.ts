import type { DeviceInstallationSummary } from './types';

export type DeviceWallRole = 'staff' | 'location_manager' | 'brand_owner' | 'platform_admin';

export type DeviceWallActor = {
  readonly userId: string;
  readonly brandId: string;
  readonly role: DeviceWallRole;
  readonly locationIds: readonly string[];
};

export type DeviceWallPermission =
  | 'read_status' | 'register_own' | 'manage' | 'diagnose' | 'view_stream' | 'share_own';

function sameScope(actor: DeviceWallActor, installation: DeviceInstallationSummary): boolean {
  if (actor.brandId !== installation.brandId) return false;
  if (actor.role === 'brand_owner' || actor.role === 'platform_admin') return true;
  return actor.locationIds.includes(installation.locationId);
}

export function canAccessInstallation(
  actor: DeviceWallActor,
  installation: DeviceInstallationSummary,
  permission: DeviceWallPermission,
): boolean {
  if (!sameScope(actor, installation)) return false;
  if (actor.role === 'brand_owner' || actor.role === 'platform_admin') return true;
  if (actor.role === 'location_manager') return permission === 'read_status';
  const owns = installation.installedBy === actor.userId;
  return owns && (permission === 'read_status' || permission === 'register_own' || permission === 'share_own');
}

export function mayCreateEnrollment(role: DeviceWallRole): boolean {
  return role === 'brand_owner' || role === 'platform_admin';
}
