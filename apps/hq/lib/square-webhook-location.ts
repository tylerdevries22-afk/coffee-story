import type { SupabaseClient } from '@supabase/supabase-js';

/** Match provider receipt location to this exact tenant's Square connection. */
export async function squareWebhookLocationMatches(
  db: SupabaseClient,
  order: { brand_id: string; location_id: string },
  providerLocationId: string,
): Promise<boolean> {
  const result = await db.from('square_connections')
    .select('square_location_id')
    .eq('brand_id', order.brand_id)
    .eq('location_id', order.location_id)
    .maybeSingle<{ square_location_id: string | null }>();
  if (result.error) throw result.error;
  return Boolean(providerLocationId && result.data?.square_location_id === providerLocationId);
}
