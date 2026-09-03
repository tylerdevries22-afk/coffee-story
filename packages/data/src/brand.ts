import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LOCATION_STOREFRONT_COLUMNS,
  type BrandStorefrontRow,
  type LocationStorefrontRow,
} from '@platform/schema';

import { readWithRetry } from './read-retry';

export type BrandSummary = {
  brand: BrandStorefrontRow;
  locations: LocationStorefrontRow[];
};

/** Public kiosk settings for a tenant, read through the storefront lookup. */
export async function fetchBrandConfig(
  client: SupabaseClient,
  brandId: string,
): Promise<unknown | null> {
  const row = await readWithRetry('fetchBrandConfig', (signal) => client
    .rpc('brand_storefront_lookup', { p_brand_id: brandId })
    .abortSignal(signal)
    .maybeSingle<{ brand_config: unknown }>());
  return row?.brand_config ?? null;
}

/**
 * Payload-free kiosk invalidation. The device refetches the public view after
 * a signal, so no brand config or platform terms travel over Realtime.
 */
export function subscribeToBrandConfig(
  client: SupabaseClient | null,
  brandId: string,
  onChanged: () => void,
  settleMs = 250,
): () => void {
  if (!client) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let live = true;
  const settle = () => {
    if (!live) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (live) onChanged();
    }, settleMs);
  };
  const channel = client
    .channel(`brand-config-${brandId}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'brand_config_signals', filter: `brand_id=eq.${brandId}`,
    }, settle)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') settle();
    });
  return () => {
    live = false;
    if (timer) clearTimeout(timer);
    void client.removeChannel(channel);
  };
}

/**
 * The storefront bootstrap: the brand's public face (identity, feature
 * flags, brand_config tokens/copy) and its locations — both world-readable.
 * Reads brand_storefront_lookup, not brands: the table also carries the
 * platform's fee terms, which stay claim-gated (0015). The lookup takes the
 * slug as an argument rather than filtering after the fact, so anon reaches
 * exactly the one brand it names (0903005237).
 */
export async function fetchBrandBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<BrandSummary | null> {
  const brand = await readWithRetry('fetchBrandBySlug', (signal) => client
    .rpc('brand_storefront_lookup', { p_slug: slug })
    .abortSignal(signal)
    .maybeSingle<BrandStorefrontRow>());
  if (!brand) return null;
  const locations = await readWithRetry('fetchBrandBySlug locations', (signal) => client
    .from('locations')
    // Named columns, not `*`: 0040 revokes the fee terms from client roles, and
    // a client asking for every column gets an error rather than a redacted row.
    .select(LOCATION_STOREFRONT_COLUMNS)
    .eq('brand_id', brand.id)
    .order('created_at')
    .abortSignal(signal)
    .returns<LocationStorefrontRow[]>());
  return { brand, locations: locations ?? [] };
}
