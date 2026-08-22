import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { isValidSupabasePublishableKey, isValidSupabaseUrl } from './config';

/** The storage surface Supabase auth persists sessions through. Each runtime
 * supplies its own: SecureStore on native, localStorage on web, cookies in
 * HQ's server components. */
export type AuthStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
};

export type SupabaseClientConfig = {
  url: unknown;
  publishableKey: unknown;
  storage?: AuthStorage;
  /** Web auth callbacks want detectSessionInUrl; native deep links do not. */
  detectSessionInUrl?: boolean;
};

/**
 * The one place a client-side Supabase client is constructed. Returns null
 * rather than throwing on bad config so demo mode keeps working with nothing
 * set — callers branch on the null exactly as they branch on `isDemo`.
 */
export function createSupabaseClient(config: SupabaseClientConfig): SupabaseClient | null {
  if (!isValidSupabaseUrl(config.url) || !isValidSupabasePublishableKey(config.publishableKey)) {
    return null;
  }
  return createClient(config.url, config.publishableKey, {
    auth: {
      ...(config.storage ? { storage: config.storage } : {}),
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: config.detectSessionInUrl ?? false,
      flowType: 'pkce',
    },
  });
}
