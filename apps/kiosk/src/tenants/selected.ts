/** One selected tenant for native/web Metro; index.ts remains the Node audit barrel. */
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
if (!requested) throw new Error('apps/kiosk requires EXPO_PUBLIC_TENANT for a production bundle.');

const selected: TenantSlot = { slug: requested, brand, modules, menu };
export const TENANT_SLOT: TenantSlot = selectTenantSlot({
  app: 'kiosk', slots: { [requested]: selected }, requested,
});
export const TENANT_SLUG: string = TENANT_SLOT.slug;
export const APPLIED_TENANT_SLUGS: readonly string[] = [TENANT_SLUG];
