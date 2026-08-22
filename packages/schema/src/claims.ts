/**
 * The tenancy claims a Supabase JWT carries in app_metadata (rule 1). The
 * engine mints them at invite/signup; RLS reads them via the 0001 helpers.
 */
export const BRAND_ROLES = ['platform_admin', 'brand_owner', 'location_manager', 'staff'] as const;

export type BrandRole = (typeof BRAND_ROLES)[number];

export type TenantClaims = {
  brand_id: string;
  /** Empty for brand_owner and platform_admin: brand-wide scope. */
  location_ids: string[];
  /** Absent for end customers: a guest has a brand but no staff role. */
  role?: BrandRole;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates untrusted app_metadata into claims, or null. Fail closed: a JWT
 * with a malformed brand_id grants nothing rather than something surprising.
 */
export function parseTenantClaims(metadata: unknown): TenantClaims | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const source = metadata as Record<string, unknown>;
  const brandId = source.brand_id;
  if (typeof brandId !== 'string' || !UUID.test(brandId)) return null;

  const rawLocations = Array.isArray(source.location_ids) ? source.location_ids : [];
  const locationIds: string[] = [];
  for (const value of rawLocations) {
    if (typeof value !== 'string' || !UUID.test(value)) return null;
    locationIds.push(value);
  }

  const role = source.role;
  if (role !== undefined && !BRAND_ROLES.includes(role as BrandRole)) return null;

  return {
    brand_id: brandId,
    location_ids: locationIds,
    ...(role !== undefined ? { role: role as BrandRole } : {}),
  };
}

export function isStaffRole(claims: TenantClaims | null): boolean {
  return claims?.role !== undefined;
}

export function canManageLocation(claims: TenantClaims | null, locationId: string): boolean {
  if (!claims?.role) return false;
  if (claims.role === 'platform_admin' || claims.role === 'brand_owner') return true;
  return claims.location_ids.includes(locationId);
}
