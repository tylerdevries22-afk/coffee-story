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
    const json = globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { role?: unknown };
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
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
