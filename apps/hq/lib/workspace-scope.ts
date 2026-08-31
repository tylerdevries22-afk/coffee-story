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

import { hasRole } from './auth';
import { loadLocations } from './data';
import type { SessionInfo } from './demo-data';
import { isConfigured, serverClient } from './supabase-server';
import { TENANT_ORGS, tenantOrgById, type TenantLocation, type WorkspaceOrgKind } from './tenants';
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

type BrandRow = { id: string; slug: string | null; name: string };

/**
 * The organizations this session may switch between, as full tenant records
 * (config + locations) so callers can theme and scope without a second read.
 *
 * Demo/unconfigured: the whole tenant registry. Configured: a platform_admin
 * sees every brand row RLS returns; anyone else sees only their home brand,
 * because a role name cannot widen the set of tenants they may read.
 */
async function authorizedOrgs(session: SessionInfo): Promise<readonly {
  org: WorkspaceOrg;
  brandConfig: unknown;
  locations: readonly TenantLocation[];
}[]> {
  if (!isConfigured()) {
    return TENANT_ORGS.map((org) => ({
      org: { id: org.id, name: org.name, kind: org.kind },
      brandConfig: org.brandConfig,
      locations: org.locations,
    }));
  }
  const home = {
    org: { id: session.brandId, name: session.brandName, kind: 'brand' as const },
    brandConfig: null as unknown,
    locations: [] as readonly TenantLocation[],
  };
  if (!hasRole(session, 'platform_admin')) return [home];
  const client = await serverClient();
  if (!client) return [home];
  const rows = await client.from('brands').select('id, slug, name').order('name').returns<BrandRow[]>();
  if (rows.error || !rows.data?.length) return [home];
  return rows.data.map((row) => ({
    org: { id: row.id, name: row.name, kind: 'brand' as WorkspaceOrgKind },
    brandConfig: null,
    locations: [],
  }));
}

/** Locations for the selected org, RLS-scoped. Only the session's home brand is
 *  readable under RLS, so other brands surface no locations until impersonated
 *  through the platform API -- the switcher never leaks another tenant's rows. */
async function locationsForSelectedOrg(
  session: SessionInfo,
  selected: { org: WorkspaceOrg; locations: readonly TenantLocation[] },
): Promise<readonly WorkspaceLocation[]> {
  if (!isConfigured()) {
    return selected.locations.map((location) => ({ id: location.id, name: location.name, city: location.city }));
  }
  if (selected.org.id !== session.brandId) return [];
  const rows = await loadLocations();
  return rows.map((row) => ({ id: row.id, name: row.name, city: row.city }));
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

  const locations = await locationsForSelectedOrg(session, selected);
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
  const locations = await locationsForSelectedOrg(session, selected);
  return locations.some((location) => location.id === locationId) ? locationId : null;
}

/** A stable slug for the selected org, for status links and telemetry. */
export function orgSlug(name: string): string {
  return slugify(name, 64) || 'tenant';
}
