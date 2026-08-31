import type { SupabaseClient } from '@supabase/supabase-js';

export function canCreateLocation(
  multiLocationEnabled: boolean,
  existingLocationCount: number,
): boolean {
  return multiLocationEnabled || existingLocationCount === 0;
}

/** Fail closed when either live capacity read cannot be established. */
export async function locationCreationAllowed(
  client: SupabaseClient,
  brandId: string,
): Promise<boolean | null> {
  const [feature, existing] = await Promise.all([
    client.from('brands').select('multi_location').eq('id', brandId)
      .maybeSingle<{ multi_location: boolean }>(),
    client.from('locations').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
  ]);
  if (feature.error || existing.error || feature.data === null) return null;
  return canCreateLocation(feature.data.multi_location, existing.count ?? 0);
}
