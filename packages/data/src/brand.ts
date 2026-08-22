import type { SupabaseClient } from '@supabase/supabase-js';

import type { BrandStorefrontRow, LocationRow } from '@platform/schema';

export type BrandSummary = {
  brand: BrandStorefrontRow;
  locations: LocationRow[];
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
    .select('*')
    .eq('brand_id', brand.data.id)
    .order('created_at')
    .returns<LocationRow[]>();
  if (locations.error) throw new Error(`fetchBrandBySlug locations: ${locations.error.message}`);
  return { brand: brand.data, locations: locations.data ?? [] };
}
