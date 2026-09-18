/**
 * The tenant registry the console's organization switcher reads when no
 * Supabase environment is present, so the demo shows a real franchise tree
 * with zero infrastructure. Each entry is a tenant folder under /tenants, read
 * from ./tenants.generated.ts, which is generated from the tree: a folder is in
 * the switcher on the commit that adds it, with nothing here to remember. What
 * stays hand-written is what is a decision rather than a scan -- the order,
 * and the launch tenant's fixture id and locations.
 *
 * An "organization" in HQ is a tenant (a brand, or the operator that runs the
 * platform). Switching it re-themes and re-scopes the whole console -- the
 * demo made concrete. In a configured deployment the org list comes from the
 * brands the signed-in user may read under RLS (lib/workspace-scope.ts); this
 * registry is the demo fallback and the source of per-tenant theming.
 *
 * Nothing here is coffee-specific by contract: the registry carries whatever
 * tenants the platform onboards, of any industry (Stillpoint Builders is a
 * construction franchise, not a shop), which is what makes the same five apps
 * reusable across verticals.
 */
import { DEMO_LOCATIONS, DEMO_SESSION } from './demo-data';
import { GENERATED_TENANTS, type GeneratedTenant } from './tenants.generated';

export type WorkspaceOrgKind = 'operator' | 'brand';

export type TenantLocation = {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  /**
   * The site's own IANA zone and trading hours.
   *
   * Stated per location rather than defaulted, because the default was wrong
   * and silently so: every org but the launch tenant was synthesized as
   * `America/New_York` with retail hours, which put a coffee shop's
   * `Mon-Sun 08:00-20:00` on a construction franchise's head office in
   * Michigan. Same UTC offset as Detroit, so nothing looked broken.
   */
  readonly timezone: string;
  readonly hours: string;
};

export type TenantOrg = {
  /** Stable identifier the switcher posts back. A brand UUID once configured,
   *  the tenant slug in the demo -- both re-validated against this list. */
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly kind: WorkspaceOrgKind;
  /** brand.json (or an inline config) used to theme the console for this org. */
  readonly brandConfig: unknown;
  /**
   * The modules this tenant actually runs, from its own `modules.json`.
   *
   * Demo mode has no database, so this is what the console gates on. It used to
   * gate on one hard-coded list that mirrored the launch tenant, which meant
   * selecting Stillpoint Builders -- a construction franchise -- offered Drops,
   * Campaigns and Operations and hid the one module it runs. For a platform
   * whose pitch is that the same five apps serve any industry, the demo
   * demonstrated the opposite of its claim.
   */
  readonly moduleKeys: readonly string[];
  readonly locations: readonly TenantLocation[];
};

type ManifestLocation = {
  name?: string;
  address?: { city?: string };
  timezone?: string;
  hours?: Record<string, readonly { open?: string; close?: string }[]>;
};

function manifestLocations(config: unknown, tenantSlug: string): readonly TenantLocation[] {
  const locations = (config as { locations?: ManifestLocation[] }).locations ?? [];
  return locations.map((location, index) => ({
    id: `${tenantSlug}-${index + 1}`,
    name: location.name ?? `Location ${index + 1}`,
    city: location.address?.city ?? 'Location pending',
    timezone: location.timezone ?? 'UTC',
    hours: summarizeHours(location.hours),
  }));
}

function summarizeHours(hours: ManifestLocation['hours']): string {
  if (!hours) return 'Hours pending';
  const shifts = Object.values(hours).flat();
  const first = shifts.find((shift) => shift.open && shift.close);
  return first ? `${first.open}–${first.close} local` : 'By appointment';
}

/**
 * The order the switcher lists tenants in. Callers fall back to the first
 * entry as the demo default, so this is chosen, not scanned. A tenant folder
 * not named here still appears -- after these, alphabetically -- so a new
 * tenant needs an edit here only to move up the list, never to be on it.
 */
const SWITCHER_ORDER: readonly string[] = [
  'stillpoint-builders',
  'coffee-story',
  // The third slot is the neutral tenant: a brand with no vertical of its
  // own, which is what proves the console is not coffee-shaped. It was
  // Demo Roastery, which had no guest-app bundle and not one image file --
  // a switcher entry whose apps could not be opened and whose menu was
  // empty. Juniper Base Demo is already applied into both guest bundles
  // (apps/*/src/tenants/applied.json), so this entry and those builds now
  // describe the same tenant.
  'juniper-base-demo',
  // The network operator, and the first entry that is neither a shop nor a
  // site: ACTZ owns venue brands rather than trading itself, so it declares
  // no location and installs no commerce module. Every other entry has at
  // least one location, which is exactly why it belongs here -- a switcher
  // that only holds sellers cannot show a franchisor's console at all.
  'actz',
  // A member of the network above, and the first franchisee in the registry.
  // Every other entry owns itself; this one inherits its defaults from ACTZ
  // and overrides what it chooses to, which is the relationship a real chain
  // has with the network it joins.
  //
  // It is a chain rather than a single hotel deliberately: `locations` is the
  // branch list, so the console shows a switchable set of properties under
  // one brand, and each branch's lobby screen is its own.
  'summit-ridge-hotels',
];

/**
 * The launch tenant reuses the demo session's brand id, so the default
 * selection and the demo fixtures (locations, KPIs) line up out of the box;
 * for the same reason its locations are those fixtures, not its brand.json's.
 */
const LAUNCH_TENANT = 'coffee-story';

function compareSlugs(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The tenants in SWITCHER_ORDER first, in that order, then the rest by slug. */
export function switcherOrder<T extends { readonly slug: string }>(tenants: readonly T[]): T[] {
  const rank = (slug: string): number => {
    const index = SWITCHER_ORDER.indexOf(slug);
    return index === -1 ? SWITCHER_ORDER.length : index;
  };
  return [...tenants].sort((a, b) => rank(a.slug) - rank(b.slug) || compareSlugs(a.slug, b.slug));
}

function tenantOrg(tenant: GeneratedTenant): TenantOrg {
  const launch = tenant.slug === LAUNCH_TENANT;
  return {
    id: launch ? DEMO_SESSION.brandId : tenant.slug,
    slug: tenant.slug,
    name: tenant.brand.identity.name,
    // A tenant, never the platform. 'operator' is the badge the workspace
    // switcher reserves for the platform's own account, and the demo was
    // tagging its construction tenant, Stillpoint Builders, with it -- exactly
    // the identity mix-up a live pitch to a second franchisee would surface.
    // ACTZ runs a network and is still a tenant of the platform, not the
    // platform. No demo org is the platform operator, so none carries that kind.
    kind: 'brand',
    brandConfig: tenant.brand,
    moduleKeys: enabledModuleKeys(tenant.modules),
    locations: launch
      ? DEMO_LOCATIONS.map((location) => ({
        id: location.id,
        name: location.name,
        city: location.city,
        timezone: location.timezone,
        hours: location.hours,
      }))
      : manifestLocations(tenant.brand, tenant.slug),
  };
}

/** Every organization the demo console can switch between, in switcher order. */
export const TENANT_ORGS: readonly TenantOrg[] = switcherOrder(GENERATED_TENANTS).map(tenantOrg);

/**
 * The enabled module keys of a tenant manifest.
 *
 * Read from the manifest rather than restated, so a tenant's capabilities in
 * the demo cannot drift from what it declares on disk. `enabled: false` is a
 * declared-but-off module and must not be offered.
 */
function enabledModuleKeys(manifest: GeneratedTenant['modules']): readonly string[] {
  return manifest.modules.filter((entry) => entry.enabled !== false).map((entry) => entry.key);
}

export function tenantOrgById(id: string | null | undefined): TenantOrg | null {
  if (!id) return null;
  return TENANT_ORGS.find((org) => org.id === id) ?? null;
}
