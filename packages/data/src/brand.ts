import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LOCATION_STOREFRONT_COLUMNS,
  type BrandStorefrontRow,
  type LocationStorefrontRow,
} from '@platform/schema';

export type BrandSummary = {
  brand: BrandStorefrontRow;
  locations: LocationStorefrontRow[];
};

/**
 * The storefront bootstrap: the brand's public face (identity, feature
 * flags, brand_config tokens/copy) and its locations — both world-readable.
 * This reads the brand_storefront VIEW, not brands: the table also carries
 * the platform's fee terms, which stay claim-gated (0015).
 */
export async function fetchBrandBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<BrandSummary | null> {
  const brand = await client
    .from('brand_storefront')
    .select('*')
    .eq('slug', slug)
    .maybeSingle<BrandStorefrontRow>();
  if (brand.error) throw new Error(`fetchBrandBySlug: ${brand.error.message}`);
  if (!brand.data) return null;
  const locations = await client
    .from('locations')
    // Named columns, not `*`: 0040 revokes the fee terms from client roles, and
    // a client asking for every column gets an error rather than a redacted row.
    .select(LOCATION_STOREFRONT_COLUMNS)
    .eq('brand_id', brand.data.id)
    .order('created_at')
    .returns<LocationStorefrontRow[]>();
  if (locations.error) throw new Error(`fetchBrandBySlug locations: ${locations.error.message}`);
  return { brand: brand.data, locations: locations.data ?? [] };
}
