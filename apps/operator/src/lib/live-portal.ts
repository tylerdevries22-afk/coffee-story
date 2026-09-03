/**
 * The live staff bundle: who this operator is at the shop. Tenancy is by
 * login (rule 7) — the claims hook mints brand_id / role / location_ids into
 * the access token from brand_users, this module reads them back, and every
 * board query the store makes is scoped by those claims under RLS.
 */
import { parseTenantClaims, type TenantClaims } from '@platform/schema';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import type { PortalBundle } from '@platform/domain';

export type StaffContext = {
  bundle: PortalBundle;
  claims: TenantClaims;
  brandName: string;
  operationsEnabled: boolean;
  brandUserId: string;
  /** brand_config from the brands row: tokens, copy, business details. */
  brandConfig: unknown;
  /** The locations this account may work, claims-scoped for shift staff. */
  locations: StaffLocation[];
};

/** A location as the staff app needs it: enough to scope the board, plus the
 * posted address and wall-clock zone, which are per location (rule 1) and not
 * on the brand. */
export type StaffLocation = {
  id: string;
  name: string;
  address: { street?: string; city?: string; region?: string; postal?: string } | null;
  timezone: string | null;
};

/** The hook-minted tenancy claims ride in the token payload, not in the
 * stored user record — decode the token itself. */
export function tenantClaimsFromSession(session: Session): TenantClaims | null {
  const payload = session.access_token.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      typeof atob === 'function'
        ? atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        : Buffer.from(payload, 'base64').toString('utf8'),
    ) as { app_metadata?: unknown };
    return parseTenantClaims(decoded.app_metadata);
  } catch {
    return null;
  }
}

/** The one read that decides whether this app shows a shift board. */
export type ModuleInstallationReader = (brandId: string) => Promise<{
  data: { module_key: string }[] | null;
  error: unknown;
}>;

/**
 * Whether this brand runs operations, asked of `module_installations`.
 *
 * It used to be `brands.operations`, a boolean nothing else in the platform
 * agreed with -- a suspended installation left every grant in place. Migration
 * 20260903220000 made an active `workforce-operations` installation the
 * database's answer, and this is the app asking the same question the same way.
 *
 * Failure denies, and the failure is not raised. The two cases are different
 * on purpose: a brand that has not installed the module and a brand whose
 * capability read failed both get a staff app with no shift board, because
 * neither is a brand that may run operations -- but only the first is normal,
 * and throwing here would take the orders board down with it over a module the
 * account may not even use.
 */
export async function operationsInstalled(
  read: ModuleInstallationReader,
  brandId: string,
): Promise<boolean> {
  const { data, error } = await read(brandId);
  if (error || !data) return false;
  return data.length > 0;
}

export async function loadStaffContext(
  client: SupabaseClient,
  session: Session,
): Promise<StaffContext> {
  const claims = tenantClaimsFromSession(session);
  if (!claims?.role) {
    throw new Error('This account has no staff access at this shop. Ask the owner to add you.');
  }

  const brand = await client
    .from('brands')
    .select('id, name, brand_config')
    .eq('id', claims.brand_id)
    .single<{ id: string; name: string; brand_config: unknown }>();
  if (brand.error) throw new Error(`The shop could not be loaded: ${brand.error.message}`);

  const membership = await client.from('brand_users').select('id')
    .eq('brand_id', claims.brand_id).eq('user_id', session.user.id).single<{ id: string }>();
  if (membership.error) throw new Error('Your current staff membership could not be loaded.');

  const locationsQuery = client
    .from('locations')
    .select('id, name, address, timezone')
    .eq('brand_id', claims.brand_id)
    .order('created_at');
  const locations = await (claims.role === 'staff' && claims.location_ids.length > 0
    ? locationsQuery.in('id', claims.location_ids)
    : locationsQuery
  ).returns<StaffLocation[]>();
  if (locations.error) throw new Error(`Locations could not be loaded: ${locations.error.message}`);

  const operationsEnabled = await operationsInstalled(
    async (brandId) => client
      .from('module_installations')
      .select('module_key')
      .eq('brand_id', brandId)
      .eq('module_key', 'workforce-operations')
      .eq('state', 'active')
      .returns<{ module_key: string }[]>(),
    claims.brand_id,
  );

  const metadata = session.user.user_metadata as { full_name?: string } | null;
  const bundle: PortalBundle = {
    profile: {
      id: session.user.id,
      fullName: metadata?.full_name ?? session.user.email ?? 'Staff',
      email: session.user.email ?? '',
      phone: null,
      birthday: null,
      avatarUrl: null,
    },
    role: claims.role === 'staff' ? 'staff' : 'admin',
    orders: [],
    rewardAccount: {
      availablePoints: 0,
      annualPoints: 0,
      cashCents: 0,
      annualPeriodStart: `${new Date().getFullYear()}-01-01`,
    },
    rewardLedger: [],
    rewardActivities: [],
    rewardCatalog: [],
    giftCards: [],
    // Guest-side domains stay absent on a staff account.
  };

  return {
    bundle,
    claims,
    brandName: brand.data.name,
    operationsEnabled,
    brandUserId: membership.data.id,
    brandConfig: brand.data.brand_config,
    locations: locations.data ?? [],
  };
}
