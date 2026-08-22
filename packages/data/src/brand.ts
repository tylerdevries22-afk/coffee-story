import type { SupabaseClient } from '@supabase/supabase-js';

import type { BrandRow, LocationRow } from '@platform/schema';

export type BrandSummary = {
  brand: BrandRow;
  locations: LocationRow[];
};

/**
 * The storefront bootstrap: the brand row (feature flags + brand_config
 * tokens/copy) and its locations. Both are world-readable by policy — a guest
 * browses the shop before signing in.
 */
export async function fetchBrandBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<BrandSummary | null> {
  const brand = await client.from('brands').select('*').eq('slug', slug).maybeSingle<BrandRow>();
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
