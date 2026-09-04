/**
 * The product cut-outs this build ships, for the tenant it was built for.
 *
 * Resolved through the generated `src/tenants/media` barrel, which names one
 * `.webp` per seated cut-out per applied tenant.
 *
 * A menu slug missing from this map is not an error. `resolveProductMedia`
 * returns null and the shelf is one row shorter -- a tenant part-way through
 * shooting its menu still boots, which is the one place this path deliberately
 * differs from the menu photographs.
 */
import { EMPTY_PRODUCT_MEDIA, type ProductMediaCatalog } from '@platform/domain';

import { TENANT_MEDIA } from '../tenants/media';

/** menu slug -> Metro module id. The one place a cut-out asset is named. */
export const BUNDLED_CUTOUTS: Readonly<Record<string, number>> = TENANT_MEDIA.productMedia;

/**
 * The catalog the resolver reads.
 *
 * `remote` stays empty until `menu_items.image_url` has a writer. Nothing
 * about this file or its callers changes when it does -- that is the whole
 * reason the resolver returns a reference rather than a module id.
 */
export const TENANT_PRODUCT_MEDIA: ProductMediaCatalog = {
  bundled: new Set(Object.keys(BUNDLED_CUTOUTS)),
  remote: EMPTY_PRODUCT_MEDIA.remote,
};
