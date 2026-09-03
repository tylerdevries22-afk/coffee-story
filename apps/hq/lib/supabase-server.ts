/**
 * The console's server-side Supabase client, bound to the request cookies:
 * every query runs under the signed-in user's own RLS. No service-role key
 * comes anywhere near page rendering — the trusted-write surface is the
 * platform API routes, which construct their own client.
 */
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { fetchWithRetry } from '@platform/api-client';

import { previewWallRuntimeEnabled } from './demo-sync-http';

export function isConfigured(): boolean {
  return !previewWallRuntimeEnabled()
    && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Null when the deployment carries no Supabase env — pages fall back to
 * fixtures.
 *
 * Memoized per request. A console render used to construct one client per
 * caller — the layout, the session, and every page-level loader — each reading
 * the cookie store and installing its own fetch wrapper, for a client that is
 * identical every time within one request. `cache` is request-scoped, so a
 * server action still gets its own client and can still write refreshed
 * cookies through it.
 */
export const serverClient = cache(async function serverClient(): Promise<SupabaseClient | null> {
  if (!isConfigured()) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) return null;
  const store = await cookies();
  return createServerClient(
    url,
    publishableKey,
    {
      global: { fetch: (input, init) => fetchWithRetry(input, init) },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (updates) => {
          // Server components render read-only; server actions and route
          // handlers may write. try/catch keeps one client good for both.
          try {
            for (const { name, value, options } of updates) store.set(name, value, options);
          } catch {
            // Read-only context: token refresh happens in middleware instead.
          }
        },
      },
    },
  );
});
