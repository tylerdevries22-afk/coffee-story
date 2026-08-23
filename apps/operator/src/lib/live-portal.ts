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
  /** brand_config from the brands row: tokens, copy, business details. */
  brandConfig: unknown;
  /** The locations this account may work, claims-scoped for shift staff. */
  locations: { id: string; name: string }[];
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

  const locationsQuery = client
    .from('locations')
    .select('id, name')
    .eq('brand_id', claims.brand_id)
    .order('created_at');
  const locations = await (claims.role === 'staff' && claims.location_ids.length > 0
    ? locationsQuery.in('id', claims.location_ids)
    : locationsQuery
  ).returns<{ id: string; name: string }[]>();
  if (locations.error) throw new Error(`Locations could not be loaded: ${locations.error.message}`);

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
    brandConfig: brand.data.brand_config,
    locations: locations.data ?? [],
  };
}
