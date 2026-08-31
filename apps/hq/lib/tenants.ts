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
import demoRoasteryBrand from '../../../tenants/demo-roastery/brand.json';
import stillpointBrand from '../../../tenants/stillpoint-builders/brand.json';

import { DEMO_LOCATIONS, DEMO_SESSION } from './demo-data';

export type WorkspaceOrgKind = 'operator' | 'brand';

export type TenantLocation = {
  readonly id: string;
  readonly name: string;
  readonly city: string;
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
  readonly locations: readonly TenantLocation[];
};

const STILLPOINT_LOCATIONS: readonly TenantLocation[] = [
  { id: 'sp-hq', name: 'Head office', city: 'Grand Rapids, MI' },
  { id: 'sp-north', name: 'North region', city: 'Traverse City, MI' },
];

const DEMO_ROASTERY_LOCATIONS: readonly TenantLocation[] = [
  { id: 'dr-market', name: 'Market Street', city: 'Portland, OR' },
  { id: 'dr-pier', name: 'Pier 7', city: 'Portland, OR' },
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
    locations: STILLPOINT_LOCATIONS,
  },
  {
    id: DEMO_SESSION.brandId,
    slug: 'coffee-story',
    name: 'Coffee Story',
    kind: 'brand',
    brandConfig: coffeeStoryBrand,
    locations: DEMO_LOCATIONS.map((location) => ({ id: location.id, name: location.name, city: location.city })),
  },
  {
    id: 'demo-roastery',
    slug: 'demo-roastery',
    name: 'Demo Roastery',
    kind: 'brand',
    brandConfig: demoRoasteryBrand,
    locations: DEMO_ROASTERY_LOCATIONS,
  },
];

export function tenantOrgById(id: string | null | undefined): TenantOrg | null {
  if (!id) return null;
  return TENANT_ORGS.find((org) => org.id === id) ?? null;
}
