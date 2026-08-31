import { canManageLocation, type TenantClaims } from '@platform/schema';

type IdentifiedLocation = { readonly id: string };

/** Keep switcher choices inside the caller's JWT location assignment. */
export function visibleWorkspaceLocations<T extends IdentifiedLocation>(
  locations: readonly T[],
  claims: TenantClaims | null,
): readonly T[] {
  if (!claims) return [];
  return locations.filter((location) => canManageLocation(claims, location.id));
}

/** UI mirror of the Square/device write boundary for the selected tenant. */
export function mayManageWorkspaceLocation(
  selectedBrandId: string | null,
  claims: TenantClaims | null,
  locationId: string,
): boolean {
  return claims !== null
    && selectedBrandId === claims.brand_id
    && canManageLocation(claims, locationId);
}
