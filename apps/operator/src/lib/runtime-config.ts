/**
 * What live mode needs from the build environment: the Supabase project.
 * That is nearly the whole backend — the board reads and writes under staff
 * RLS directly. The one exception is a refund, which moves money at Square
 * before any event is written and so must go through the platform API; that
 * URL is therefore optional here, and a build without it simply says refunds
 * are not configured on this device instead of refusing live mode. The
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
  return missing;
}
