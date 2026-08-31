import type { SupabaseClient } from '@supabase/supabase-js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns the target-brand actor row required by attributable authoring FKs. */
export async function ensurePlatformBrandMembership(
  db: SupabaseClient,
  actorId: string,
  brandId: string,
): Promise<string | null> {
  if (!UUID.test(actorId) || !UUID.test(brandId)) return null;
  const result = await db.rpc('ensure_platform_brand_membership', {
    p_actor_id: actorId,
    p_brand_id: brandId,
  });
  return !result.error && typeof result.data === 'string' && UUID.test(result.data)
    ? result.data
    : null;
}
