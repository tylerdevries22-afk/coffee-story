import 'server-only';

/**
 * Resolves the organization/location scope for the current request: which orgs
 * this session may switch between, which locations the selected org has, and
 * which of each is currently chosen. Every read re-authorizes the remembered
 * cookies against the real, role-gated set -- the switcher is a convenience,
 * not an authority. RLS remains the enforcement boundary for the data itself.
 */
import { cookies } from 'next/headers';

import { slugify } from '@platform/domain';

import type { SessionInfo } from './demo-data';
import { isConfigured, serverClient } from './supabase-server';
import { demoLocationsFor } from './demo-locations';
import { TENANT_ORGS, tenantOrgById, type WorkspaceOrgKind } from './tenants';
import { isWorkspaceCookieValue, LOCATION_COOKIE, ORG_COOKIE } from './workspace-cookie';

export type WorkspaceOrg = {
  readonly id: string;
  readonly name: string;
  readonly kind: WorkspaceOrgKind;
};

export type WorkspaceLocation = { readonly id: string; readonly name: string; readonly city: string };

export type WorkspaceScope = {
  readonly organizations: readonly WorkspaceOrg[];
  readonly locations: readonly WorkspaceLocation[];
  readonly organizationId: string | null;
  readonly locationId: string | null;
  /** The selected org's config + name, so the shell themes and titles itself
   *  for whoever is selected rather than only the session's home brand. */
  readonly brandConfig: unknown;
  readonly brandName: string;
};

type BrandRow = { id: string; slug: string | null; name: string; brand_config: unknown };
type LocationRow = { id: string; name: string; address: { city?: string } | null };

/**
 * The organizations this session may switch between, as full tenant records
 * (config + locations) so callers can theme and scope without a second read.
 *
 * Demo/unconfigured: the whole tenant registry. Configured: one `brands` read
 * whose RLS does the role work for us -- `brands_select` returns every brand to
 * a platform_admin and only the home brand to anyone else, so the same query
 * yields the operator's whole book of business or a single franchisee's org
 * without a role branch here. `brand_config` rides along for theming the
 * selected org, franchisee or not.
 */
async function authorizedOrgs(session: SessionInfo): Promise<readonly {
  org: WorkspaceOrg;
  brandConfig: unknown;
}[]> {
  if (!isConfigured()) {
    return TENANT_ORGS.map((org) => ({
      org: { id: org.id, name: org.name, kind: org.kind },
      brandConfig: org.brandConfig,
    }));
  }
  const home = {
    org: { id: session.brandId, name: session.brandName, kind: 'brand' as const },
    brandConfig: null as unknown,
  };
  const client = await serverClient();
  if (!client) return [home];
  const rows = await client
    .from('brands')
    .select('id, slug, name, brand_config')
    .order('name')
    .returns<BrandRow[]>();
  if (rows.error || !rows.data?.length) return [home];
  return rows.data.map((row) => ({
    org: { id: row.id, name: row.name, kind: 'brand' as WorkspaceOrgKind },
    brandConfig: row.brand_config ?? null,
  }));
}

/**
 * Locations for the selected org. Demo: the registry's own list. Configured: a
 * lean read filtered to the authorized org's id -- `locations_select` is
 * `using(true)`, so a platform_admin who selected a franchisee reads that
 * org's stores, while a brand_owner only ever reaches an org id that is their
 * own (authorizedOrgs never returns another). The org authorization gate, not
 * this query, is what keeps a tenant out of a neighbour's stores.
 */
async function locationsForSelectedOrg(
  selected: { org: WorkspaceOrg },
): Promise<readonly WorkspaceLocation[]> {
  if (!isConfigured()) {
    // Same in-memory store the locations page reads, so a store added through
    // the wizard is immediately selectable in the header.
    return demoLocationsFor(selected.org.id).map((location) => ({ id: location.id, name: location.name, city: location.city }));
  }
  const client = await serverClient();
  if (!client) return [];
  const rows = await client
    .from('locations')
    .select('id, name, address')
    .eq('brand_id', selected.org.id)
    .order('name')
    .returns<LocationRow[]>();
  if (rows.error) return [];
  return (rows.data ?? []).map((row) => ({ id: row.id, name: row.name, city: row.address?.city ?? '' }));
}

export async function readWorkspaceScope(session: SessionInfo): Promise<WorkspaceScope> {
  const orgs = await authorizedOrgs(session);
  const store = await cookies();

  const orgCookie = store.get(ORG_COOKIE)?.value;
  const rememberedOrg = isWorkspaceCookieValue(orgCookie)
    ? orgs.find((entry) => entry.org.id === orgCookie)
    : undefined;
  const selected = rememberedOrg
    ?? orgs.find((entry) => entry.org.id === session.brandId)
    ?? orgs[0]
    ?? null;

  if (!selected) {
    return { organizations: [], locations: [], organizationId: null, locationId: null, brandConfig: null, brandName: session.brandName };
  }

  const locations = await locationsForSelectedOrg(selected);
  const locationCookie = store.get(LOCATION_COOKIE)?.value;
  const locationId = isWorkspaceCookieValue(locationCookie)
    && locations.some((location) => location.id === locationCookie)
    ? locationCookie
    : null;

  const registry = tenantOrgById(selected.org.id);
  return {
    organizations: orgs.map((entry) => entry.org),
    locations,
    organizationId: selected.org.id,
    locationId,
    brandConfig: selected.brandConfig ?? registry?.brandConfig ?? null,
    brandName: selected.org.name,
  };
}

/** Validate a posted org id against the session's real authorized set. Returns
 *  the id when the session may select it, null otherwise -- the gate both the
 *  select action and any scope-consuming write share. */
export async function authorizeOrganization(session: SessionInfo, orgId: string): Promise<string | null> {
  const orgs = await authorizedOrgs(session);
  return orgs.some((entry) => entry.org.id === orgId) ? orgId : null;
}

export async function authorizeLocation(session: SessionInfo, orgId: string, locationId: string): Promise<string | null> {
  const orgs = await authorizedOrgs(session);
  const selected = orgs.find((entry) => entry.org.id === orgId);
  if (!selected) return null;
  const locations = await locationsForSelectedOrg(selected);
  return locations.some((location) => location.id === locationId) ? locationId : null;
}

/** A stable slug for the selected org, for status links and telemetry. */
export function orgSlug(name: string): string {
  return slugify(name, 64) || 'tenant';
}
