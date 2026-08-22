/**
 * Validators for the two Supabase values that are safe to inline into a
 * public bundle. Promoted from the apps' twin `lib/runtime-config.ts` copies;
 * the env reading itself stays in each app because `process.env.EXPO_PUBLIC_*`
 * must be written literally there for Metro to inline it.
 */

export function isValidSupabaseUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:'
      || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}

/**
 * Accepts only a key that is safe to inline into a public bundle.
 *
 * This used to be `length >= 20`, which accepts a `service_role` JWT — the
 * client would then ship full database authority in the JavaScript every
 * guest downloads. The two safe shapes are the modern `sb_publishable_` key
 * and the legacy anon JWT, and an anon JWT is recognised by its role claim
 * rather than by being a JWT at all.
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
 * React Native does not put `atob` on the global scope, so calling it here
 * would throw on Hermes. The throw would be swallowed by the caller's catch,
 * `jwtRoleClaim` would return null, and a perfectly good legacy anon key
 * would be reported as missing config — the app would then refuse live mode
 * on device only, for exactly the guests who had it configured correctly.
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
