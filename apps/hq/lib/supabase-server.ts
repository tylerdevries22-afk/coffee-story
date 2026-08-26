/**
 * The console's server-side Supabase client, bound to the request cookies:
 * every query runs under the signed-in user's own RLS. No service-role key
 * comes anywhere near page rendering — the trusted-write surface is the
 * platform API routes, which construct their own client.
 */
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { fetchWithRetry } from '@platform/api-client';

import { previewWallRuntimeEnabled } from './demo-sync-http';

export function isConfigured(): boolean {
  return !previewWallRuntimeEnabled()
    && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Null when the deployment carries no Supabase env — pages fall back to fixtures. */
export async function serverClient(): Promise<SupabaseClient | null> {
  if (!isConfigured()) return null;
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
}
