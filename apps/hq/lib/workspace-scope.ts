import 'server-only';

/**
 * Resolves the organization/location scope for the current request: which orgs
 * this session may switch between, which locations the selected org has, and
 * which of each is currently chosen. Every read re-authorizes the remembered
 * cookies against the real, role-gated set -- the switcher is a convenience,
 * not an authority. RLS remains the enforcement boundary for the data itself.
 */
import { cookies } from 'next/headers';
import { cache } from 'react';

import { slugify } from '@platform/domain';

import { currentClaims } from './auth';
import type { SessionInfo } from './demo-data';
import { isConfigured, serverClient } from './supabase-server';
import { demoLocationsFor } from './demo-locations';
import { allDemoOrgs, demoOrgById } from './demo-orgs';
import type { WorkspaceOrgKind } from './tenants';
import { isWorkspaceCookieValue, LOCATION_COOKIE, ORG_COOKIE } from './workspace-cookie';
import { visibleWorkspaceLocations } from './workspace-location-access';

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
 *
 * Memoized per request, for the same reason currentSession is. Four exported
 * functions in this file call it -- readWorkspaceScope, selectedOrganizationId,
 * authorizeOrganization, authorizeLocation -- and selectedOrganizationId alone
 * has call sites in nineteen files, so a single console render asked for the
 * whole brand list several times over. The query is unbounded by design (a
 * platform_admin legitimately sees every brand) and carries brand_config, which
 * the platform caps at 16 KB per brand, so the repeats are the expensive kind.
 * cache() is request-scoped, which is the right lifetime: a switcher that
 * cached across requests would keep showing an org after access was revoked.
 */
const authorizedOrgs = cache(async function authorizedOrgs(session: SessionInfo): Promise<readonly {
  org: WorkspaceOrg;
  brandConfig: unknown;
}[]> {
  if (!isConfigured()) {
    return allDemoOrgs().map((org) => ({
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
});

/**
 * Locations for the selected org. Demo: the registry's own list. Configured: a
 * lean read filtered to the authorized org's id. The result is also narrowed
 * through the JWT's `location_ids`: a restricted manager cannot remember a
 * store that RLS will later hide, while owners and platform admins retain the
 * brand-wide access encoded by `canManageLocation`.
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
  const [rows, claims] = await Promise.all([
    client.from('locations').select('id, name, address')
      .eq('brand_id', selected.org.id).order('name').returns<LocationRow[]>(),
    currentClaims(),
  ]);
  if (rows.error) return [];
  const locations = (rows.data ?? []).map((row) => ({
    id: row.id, name: row.name, city: row.address?.city ?? '',
  }));
  return visibleWorkspaceLocations(locations, claims);
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

  // Demo-only, like every other read of this registry in this file. Left
  // ungated, a configured deployment whose `brands.brand_config` came back null
  // would theme its console from a bundled fixture -- one of the tenant
  // brand.json files statically imported by ./tenants -- which is another
  // tenant's configuration. Not reachable today, because the registry is keyed
  // by slugs and one fixture UUID that no real brand row carries; it becomes a
  // cross-tenant leak the moment an id collides.
  const registry = isConfigured() ? null : demoOrgById(selected.org.id);
  return {
    organizations: orgs.map((entry) => entry.org),
    locations,
    organizationId: selected.org.id,
    locationId,
    brandConfig: selected.brandConfig ?? registry?.brandConfig ?? null,
    brandName: selected.org.name,
  };
}

/** The selected organization after re-authorizing the cookie for this session.
 * Data loaders use this instead of trusting the raw cookie or JWT home brand. */
export async function selectedOrganizationId(session: SessionInfo): Promise<string> {
  const orgs = await authorizedOrgs(session);
  const value = (await cookies()).get(ORG_COOKIE)?.value;
  const selected = isWorkspaceCookieValue(value)
    ? orgs.find((entry) => entry.org.id === value)
    : undefined;
  return selected?.org.id
    ?? orgs.find((entry) => entry.org.id === session.brandId)?.org.id
    ?? orgs[0]?.org.id
    ?? session.brandId;
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
