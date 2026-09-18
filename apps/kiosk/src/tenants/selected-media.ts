/* eslint-disable import/no-unresolved -- Metro resolves @tenant-bundle to one validated tenant. */
import { TENANT_MENU_MEDIA } from '@tenant-bundle/generated/menu-media';
import brandLogo from '@tenant-bundle/artwork/brand/logo.png';

/**
 * A Metro asset id on native and on a normal tenant's web export; a runtime
 * source on the demo runtime web export, whose media lives behind the
 * cookie-gated /d/media/ proxy rather than in the bundle (see
 * ../demo-runtime/pack.ts). expo-image already accepts both shapes, so this
 * widening reaches almost no call site.
 */
export type TenantImageSource = number | { readonly uri: string };

export type TenantMediaSlot = {
  readonly brandLogo: TenantImageSource;
  readonly menuMedia: Readonly<Record<string, TenantImageSource>>;
};

export const TENANT_MEDIA: TenantMediaSlot = {
  brandLogo,
  menuMedia: TENANT_MENU_MEDIA,
};
