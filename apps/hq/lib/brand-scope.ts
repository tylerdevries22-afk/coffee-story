/**
 * The selected brand's stored configuration, read once per request.
 *
 * The console shell needs it for two unrelated things -- the theme it hydrates
 * the rail with, and the tenant's own analytics policy -- and the same row was
 * being selected again by callers that only wanted one of them. `operations`
 * is deliberately no longer selected here: what a brand may run comes from
 * `module_installations` (lib/capabilities), and leaving the column in the
 * projection would leave a second answer to that question in the shell.
 */
import { cache } from 'react';

import { serverClient } from './supabase-server';

export const brandConfigFor = cache(async (brandId: string | null): Promise<unknown> => {
  if (brandId === null) return null;
  const client = await serverClient();
  if (!client) return null;
  const row = await client
    .from('brands')
    .select('brand_config')
    .eq('id', brandId)
    .maybeSingle<{ brand_config: unknown }>();
  // A failed read is a missing theme, not a denied one: the shell falls back
  // to the platform tokens, which is what an unthemed console already renders.
  return row.error ? null : row.data?.brand_config ?? null;
});
