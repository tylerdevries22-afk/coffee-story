/**
 * What live mode needs from the build environment: the Supabase project.
 * That is nearly the whole backend — the board reads and writes under staff
 * RLS directly. Refunds and training quiz submissions must go through the
 * platform API, so a production operator build requires that endpoint. The
 * validators live in @platform/data — one definition of "safe to inline into
 * a public bundle" for every app.
 */
import { isValidSupabasePublishableKey, isValidSupabaseUrl } from '@platform/data';

export { isValidSupabasePublishableKey, isValidSupabaseUrl } from '@platform/data';

export type MobileLiveConfig = {
  supabaseUrl: unknown;
  supabasePublishableKey: unknown;
  apiUrl: unknown;
  allowedApiHost: unknown;
};

export function isValidApiUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch {
    return false;
  }
}

function isLocalApiUrl(value: unknown): boolean {
  if (!isValidApiUrl(value)) return false;
  const hostname = new URL(value).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * The live values as this build carries them.
 *
 * Each `process.env.EXPO_PUBLIC_*` is written out literally so Metro inlines
 * it; a computed lookup would resolve to undefined in the bundle.
 */
export function liveConfigFromEnv(): MobileLiveConfig {
  return {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    allowedApiHost: process.env.EXPO_PUBLIC_ALLOWED_API_HOST,
  };
}

/**
 * Whether live mode can actually run, by the same measure the root layout
 * uses to decide whether to show `RuntimeConfigError`.
 */
export function hasCompleteLiveConfig(): boolean {
  return missingLiveConfig(liveConfigFromEnv()).length === 0;
}

export function missingLiveConfig(config: MobileLiveConfig): string[] {
  const missing: string[] = [];
  if (!isValidSupabaseUrl(config.supabaseUrl)) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!isValidSupabasePublishableKey(config.supabasePublishableKey)) {
    missing.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  if (!isValidApiUrl(config.apiUrl)) missing.push('EXPO_PUBLIC_API_URL');
  if (!isLocalApiUrl(config.apiUrl)
    && (typeof config.allowedApiHost !== 'string' || config.allowedApiHost.length === 0)) {
    missing.push('EXPO_PUBLIC_ALLOWED_API_HOST');
  }
  return missing;
}
