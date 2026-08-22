/**
 * What live mode needs from the build environment: the Supabase project.
 * That is the operator app's whole backend — the board reads and writes
 * under staff RLS directly, so unlike the customer app there is no platform
 * API URL to configure. The validators live in @platform/data — one
 * definition of "safe to inline into a public bundle" for every app.
 */
import { isValidSupabasePublishableKey, isValidSupabaseUrl } from '@platform/data';

export { isValidSupabasePublishableKey, isValidSupabaseUrl } from '@platform/data';

export type MobileLiveConfig = {
  supabaseUrl: unknown;
  supabasePublishableKey: unknown;
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
