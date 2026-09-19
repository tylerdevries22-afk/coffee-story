import { demoPack, menuMediaOf } from '../pack';

/**
 * Item id -> its photo, as a runtime `{ uri }` source rather than a Metro
 * asset id -- see the TenantMediaSlot widening in
 * ../../tenants/selected-media.ts.
 */
export const TENANT_MENU_MEDIA: Readonly<Record<string, { readonly uri: string }>> = menuMediaOf(demoPack());
