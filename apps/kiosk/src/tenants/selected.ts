/** One selected tenant for native/web Metro; index.ts remains the Node audit barrel.
 *
 * Demo runtime mode (EXPO_PUBLIC_DEMO_RUNTIME=1, web only) is a third case:
 * there is no applied tenant to select at all, because one export serves
 * every business, chosen at request time by /d/pack.json rather than at
 * build time by EXPO_PUBLIC_TENANT. `brand`/`menu`/`modules` above already
 * resolved, at this same module load, to whatever pack the boot module
 * fetched (scripts/lib/tenant-bundle-resolver.js's demoRuntimeBundlePath
 * points every @tenant-bundle/config/* import at ../demo-runtime/ instead of
 * a tenant folder), so this only has to skip selectTenantSlot -- there is no
 * `slots` map to select from -- and name the slot after that pack's own
 * business instead of a placeholder. A production bundle built with neither
 * a tenant nor runtime mode still throws exactly as before: this branches on
 * a build-time env flag, never on anything a visitor controls.
 */
/* eslint-disable import/no-unresolved -- Metro resolves @tenant-bundle to one validated tenant. */
import { isTenantSlug, selectTenantSlot, type TenantSlotIdentity } from '@platform/domain';

import brand from '@tenant-bundle/config/brand';
import menu from '@tenant-bundle/config/menu';
import modules from '@tenant-bundle/config/modules';

import { runtimeSlug } from '../demo-runtime/pack';

export type TenantSlot = TenantSlotIdentity & {
  readonly brand: unknown;
  readonly modules: unknown;
  readonly menu: unknown;
};

function productionSlot(): TenantSlot {
  const requested = process.env.EXPO_PUBLIC_TENANT;
  if (!requested) throw new Error('apps/kiosk requires EXPO_PUBLIC_TENANT for a production bundle.');
  const selected: TenantSlot = { slug: requested, brand, modules, menu };
  return selectTenantSlot({ app: 'kiosk', slots: { [requested]: selected }, requested });
}

function demoRuntimeSlot(): TenantSlot {
  const named = process.env.EXPO_PUBLIC_TENANT?.trim();
  if (named) {
    throw new Error(
      `apps/kiosk: EXPO_PUBLIC_DEMO_RUNTIME=1 and EXPO_PUBLIC_TENANT="${named}" cannot both be set.`,
    );
  }
  return { slug: runtimeSlug(brand, isTenantSlug), brand, modules, menu };
}

export const TENANT_SLOT: TenantSlot = process.env.EXPO_PUBLIC_DEMO_RUNTIME === '1'
  ? demoRuntimeSlot()
  : productionSlot();

export const TENANT_SLUG: string = TENANT_SLOT.slug;
export const APPLIED_TENANT_SLUGS: readonly string[] = [TENANT_SLUG];
