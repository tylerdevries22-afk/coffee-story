/**
 * The single tenant visible to a production Metro graph.
 *
 * Metro remaps these neutral imports to one validated applied tenant. The
 * multi-tenant index.ts remains available to Node tests and onboarding audits,
 * but native and web entry graphs resolve index.native/web.ts to this module.
 */
/* eslint-disable import/no-unresolved -- Metro resolves @tenant-bundle to one validated tenant. */
import { selectTenantSlot, type TenantSlotIdentity } from '@platform/domain';

import brand from '@tenant-bundle/config/brand';
import menu from '@tenant-bundle/config/menu';
import modules from '@tenant-bundle/config/modules';

export type TenantSlot = TenantSlotIdentity & {
  readonly brand: unknown;
  readonly modules: unknown;
  readonly menu: unknown;
};

const requested = process.env.EXPO_PUBLIC_TENANT;
if (!requested) {
  throw new Error('apps/customer requires EXPO_PUBLIC_TENANT for a production bundle.');
}

const selected: TenantSlot = { slug: requested, brand, modules, menu };

export const TENANT_SLOT: TenantSlot = selectTenantSlot({
  app: 'customer',
  slots: { [requested]: selected },
  requested,
});

export const TENANT_SLUG: string = TENANT_SLOT.slug;
export const APPLIED_TENANT_SLUGS: readonly string[] = [TENANT_SLUG];
