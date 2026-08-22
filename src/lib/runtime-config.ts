export type MobileLiveConfig = {
  stripePublishableKey: unknown;
  supabaseUrl: unknown;
  supabasePublishableKey: unknown;
};

export function isValidStripePublishableKey(value: unknown): value is string {
  return typeof value === 'string' && /^pk_(test|live)_[A-Za-z0-9]+$/.test(value);
}

export function isValidSupabaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Accepts only a key that is safe to inline into a public bundle.
 *
 * This used to be `length >= 20`, which accepts a `service_role` JWT --
 * `lib/supabase.ts` would then ship full database authority in the JavaScript
 * every guest downloads. The two safe shapes are the modern `sb_publishable_`
 * key and the legacy anon JWT, and an anon JWT is recognised by its role
 * claim rather than by being a JWT at all.
 */
export function isValidSupabasePublishableKey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20) return false;
  if (value.startsWith('sb_publishable_')) return true;
  if (value.startsWith('sb_secret_')) return false;
  return jwtRoleClaim(value) === 'anon';
}

/** The `role` claim of a Supabase JWT, or null if it is not one. */
function jwtRoleClaim(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { role?: unknown };
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64url -> string, without `atob`.
 *
 * React Native does not put `atob` on the global scope -- it is in neither
 * `Libraries/Core` nor the shipped global type declarations -- so calling it
 * here would throw on Hermes. The throw would be swallowed by the caller's
 * catch, `jwtRoleClaim` would return null, and a perfectly good legacy anon
 * key would be reported as missing config. This app would then refuse to start
 * in live mode, on device only, for exactly the guests who had it configured
 * correctly.
 *
 * Only ASCII claims are decodable this way, which is all a Supabase JWT
 * carries (`iss`, `ref`, `role`, `iat`, `exp`).
 */
function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let bitCount = 0;
  let decoded = '';
  for (const character of normalized) {
    if (character === '=') break;
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) throw new RangeError('not base64url');
    bits = (bits << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      decoded += String.fromCharCode((bits >> bitCount) & 0xff);
    }
  }
  return decoded;
}

/**
 * The live values as this build carries them.
 *
 * Each `process.env.EXPO_PUBLIC_*` is written out literally so Metro inlines
 * it; a computed lookup would resolve to undefined in the bundle.
 */
export function liveConfigFromEnv(): MobileLiveConfig {
  return {
    stripePublishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

/**
 * Whether live mode can actually run, by the same measure the root layout
 * uses to decide whether to show `RuntimeConfigError`.
 *
 * Anything that offers live mode -- the startup default, the button on More --
 * has to ask this rather than a weaker question like "is Supabase set". A
 * build with Supabase values and no Stripe key answered yes to the weaker
 * question and then hit the error screen, with the choice already persisted.
 */
export function hasCompleteLiveConfig(): boolean {
  return missingLiveConfig(liveConfigFromEnv()).length === 0;
}

export function missingLiveConfig(config: MobileLiveConfig): string[] {
  const missing: string[] = [];
  if (!isValidStripePublishableKey(config.stripePublishableKey)) missing.push('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  if (!isValidSupabaseUrl(config.supabaseUrl)) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!isValidSupabasePublishableKey(config.supabasePublishableKey)) {
    missing.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }
  return missing;
}
