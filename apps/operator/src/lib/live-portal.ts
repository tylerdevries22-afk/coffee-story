/**
 * The live staff bundle: who this operator is at the shop. Tenancy is by
 * login (rule 7) — the claims hook mints brand_id / role / location_ids into
 * the access token from brand_users, this module reads them back, and every
 * board query the store makes is scoped by those claims under RLS.
 */
import { capabilityDrift, type ModuleInstallationRow } from '@platform/module-kit';
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

/** The legacy flag columns the dual-read window compares installations against. */
type LegacyFlagColumns = {
  drops: boolean;
  catering: boolean;
  delivery: boolean;
  stored_value: boolean;
  referrals: boolean;
  operations: boolean;
};

/**
 * Phase 2.4 dual-read: reports where module_installations disagrees with the
 * legacy flags. The flags still gate; this only logs. Staff tokens satisfy
 * module_installations_select (app.is_brand_staff), and any failure here --
 * including a resolver throw -- must never break the staff load.
 */
async function logCapabilityDrift(
  client: SupabaseClient,
  brandId: string,
  flags: LegacyFlagColumns,
): Promise<void> {
  try {
    const installations = await client
      .from('module_installations')
      .select('module_key, version, state, config_revision')
      .eq('brand_id', brandId)
      .returns<ModuleInstallationRow[]>();
    if (installations.error) {
      console.warn(JSON.stringify({
        event: 'capability_drift_error', brandId,
        reason: installations.error.message, at: new Date().toISOString(),
      }));
      return;
    }
    const drift = capabilityDrift(installations.data ?? [], flags);
    if (drift.length === 0) return;
    console.warn(JSON.stringify({
      event: 'capability_drift', brandId, drift, at: new Date().toISOString(),
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'capability_drift_error', brandId,
      reason: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    }));
  }
}

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
    .select('id, name, brand_config, drops, catering, delivery, stored_value, referrals, operations')
    .eq('id', claims.brand_id)
    .single<{ id: string; name: string; brand_config: unknown } & LegacyFlagColumns>();
  if (brand.error) throw new Error(`The shop could not be loaded: ${brand.error.message}`);

  await logCapabilityDrift(client, claims.brand_id, brand.data);

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
    operationsEnabled: brand.data.operations,
    brandUserId: membership.data.id,
    brandConfig: brand.data.brand_config,
    locations: locations.data ?? [],
  };
}
