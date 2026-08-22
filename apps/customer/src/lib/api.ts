/**
 * The platform API client: every trusted write (orders, redemptions, push
 * tokens, profile, referrals) goes through here to the HQ deployment with
 * the guest's own access token. Reads never do — they go straight to
 * Supabase under RLS via @platform/data.
 */
import { createApiClient, type ApiClient } from '@platform/api-client';

import { liveConfigFromEnv } from '@/lib/runtime-config';
import { supabase } from '@/lib/supabase';

function buildClient(): ApiClient | null {
  const config = liveConfigFromEnv();
  if (typeof config.apiUrl !== 'string' || !config.apiUrl) return null;
  return createApiClient({
    baseUrl: config.apiUrl,
    allowedHost: typeof config.allowedApiHost === 'string' ? config.allowedApiHost : undefined,
    // Loosens HTTPS/host pinning for localhost only; the guard itself stays on.
    developmentMode: true,
    getAccessToken: async () => {
      const session = await supabase?.auth.getSession();
      return session?.data.session?.access_token ?? null;
    },
  });
}

export const platformApi: ApiClient | null = buildClient();
