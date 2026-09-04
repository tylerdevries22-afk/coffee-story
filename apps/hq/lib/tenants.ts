/**
 * The tenant registry the console's organization switcher reads when no
 * Supabase environment is present, so the demo shows a real franchise tree
 * with zero infrastructure. Each entry is a tenant folder under /tenants,
 * plus the operator org that owns them.
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
import coffeeStoryBrand from '../../../tenants/coffee-story/brand.json';
import coffeeStoryModules from '../../../tenants/coffee-story/modules.json';
import demoRoasteryBrand from '../../../tenants/demo-roastery/brand.json';
import demoRoasteryModules from '../../../tenants/demo-roastery/modules.json';
import stillpointBrand from '../../../tenants/stillpoint-builders/brand.json';
import stillpointModules from '../../../tenants/stillpoint-builders/modules.json';

import { DEMO_LOCATIONS, DEMO_SESSION } from './demo-data';

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

const STILLPOINT_LOCATIONS: readonly TenantLocation[] = [
  { id: 'sp-hq', name: 'Head office', city: 'Grand Rapids, MI', timezone: 'America/Detroit', hours: 'Mon–Fri 07:00–16:00' },
  { id: 'sp-north', name: 'North region', city: 'Traverse City, MI', timezone: 'America/Detroit', hours: 'Mon–Fri 07:00–16:00' },
];

const DEMO_ROASTERY_LOCATIONS: readonly TenantLocation[] = [
  { id: 'dr-market', name: 'Market Street', city: 'Portland, OR', timezone: 'America/Los_Angeles', hours: 'Mon–Sun 07:00–19:00' },
  { id: 'dr-pier', name: 'Pier 7', city: 'Portland, OR', timezone: 'America/Los_Angeles', hours: 'Mon–Sun 07:00–19:00' },
];

/**
 * Every organization the demo console can switch between, operator first.
 * Coffee Story reuses the demo session's brand id so the default selection and
 * the demo fixtures (locations, KPIs) line up out of the box.
 */
export const TENANT_ORGS: readonly TenantOrg[] = [
  {
    id: 'stillpoint-builders',
    slug: 'stillpoint-builders',
    name: 'Stillpoint Builders',
    kind: 'operator',
    brandConfig: stillpointBrand,
    moduleKeys: enabledModuleKeys(stillpointModules),
    locations: STILLPOINT_LOCATIONS,
  },
  {
    id: DEMO_SESSION.brandId,
    slug: 'coffee-story',
    name: 'Coffee Story',
    kind: 'brand',
    brandConfig: coffeeStoryBrand,
    moduleKeys: enabledModuleKeys(coffeeStoryModules),
    locations: DEMO_LOCATIONS.map((location) => ({
      id: location.id,
      name: location.name,
      city: location.city,
      timezone: location.timezone,
      hours: location.hours,
    })),
  },
  {
    id: 'demo-roastery',
    slug: 'demo-roastery',
    name: 'Demo Roastery',
    kind: 'brand',
    brandConfig: demoRoasteryBrand,
    moduleKeys: enabledModuleKeys(demoRoasteryModules),
    locations: DEMO_ROASTERY_LOCATIONS,
  },
];

/**
 * The enabled module keys of a tenant manifest.
 *
 * Read from the manifest rather than restated, so a tenant's capabilities in
 * the demo cannot drift from what it declares on disk. `enabled: false` is a
 * declared-but-off module and must not be offered.
 */
function enabledModuleKeys(manifest: { modules: { key: string; enabled?: boolean }[] }): readonly string[] {
  return manifest.modules.filter((entry) => entry.enabled !== false).map((entry) => entry.key);
}

export function tenantOrgById(id: string | null | undefined): TenantOrg | null {
  if (!id) return null;
  return TENANT_ORGS.find((org) => org.id === id) ?? null;
}
