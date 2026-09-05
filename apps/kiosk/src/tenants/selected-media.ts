/* eslint-disable import/no-unresolved -- Metro resolves @tenant-bundle to one validated tenant. */
import { TENANT_MENU_MEDIA } from '@tenant-bundle/generated/menu-media';
import brandLogo from '@tenant-bundle/artwork/brand/logo.png';

export type TenantMediaSlot = {
  readonly brandLogo: number;
  readonly menuMedia: Readonly<Record<string, number>>;
};

export const TENANT_MEDIA: TenantMediaSlot = {
  brandLogo,
  menuMedia: TENANT_MENU_MEDIA,
};
