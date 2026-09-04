/**
 * This build's static menu-photograph map.
 *
 * View-layer: it resolves through `src/tenants/media`, which reaches `.webp`
 * modules. Domain code reads the menu from `@/tenant/menu` instead.
 */
import { TENANT_MEDIA } from '../tenants/media';

export const TENANT_MENU_MEDIA: Readonly<Record<string, number>> = TENANT_MEDIA.menuMedia;
