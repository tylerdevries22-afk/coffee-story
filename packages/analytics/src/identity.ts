/**
 * Identifiers and route keys the transport and the surface observer share.
 *
 * Split out of `transport.ts` when the queue gained durable storage: none of
 * this touches the queue, and keeping it here is what lets both the transport
 * and the observer stay under the file-size rule.
 */

/** A UUIDv4, which is what the ingestion endpoint requires of an idempotency key. */
export const ANALYTICS_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Any UUID version 1-8, which is what Postgres mints for a tenant id. */
const TENANT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomBytes(length: number, random?: () => number): number[] {
  if (!random && globalThis.crypto?.getRandomValues) {
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(length)));
  }
  const source = random ?? Math.random;
  return Array.from({ length }, () => Math.floor(source() * 256));
}

/** Creates a UUIDv4 for event and batch idempotency without adding a runtime dependency. */
export function createAnalyticsId(random?: () => number): string {
  if (!random && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = randomBytes(16, random);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Creates a rotating, non-identifying session correlation value. */
export function createSessionHash(random?: () => number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  return `h1_${randomBytes(32, random).map((value) => alphabet[value % alphabet.length] ?? 'A').join('')}`;
}

/** Returns one allowlisted screen key; unmatched or parameterized paths never leave the app. */
export function screenKeyFor(
  pathname: string,
  allowlist: Readonly<Record<string, string>>,
): string {
  const normalized = `/${pathname.split(/[?#]/, 1)[0]?.split('/').filter(Boolean).join('/') ?? ''}`;
  return allowlist[normalized] ?? 'unknown';
}

/**
 * Reads the tenant hint embedded by the Supabase access-token hook. This does
 * not authenticate the JWT; the ingestion server verifies the bearer and
 * derives tenancy again before accepting an event.
 */
export function tenantIdHintFromJwt(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let decode = '';
    let bits = 0;
    let bitCount = 0;
    for (const character of normalized.replace(/=+$/, '')) {
      const value = alphabet.indexOf(character);
      if (value < 0) return null;
      bits = (bits << 6) | value;
      bitCount += 6;
      if (bitCount >= 8) {
        bitCount -= 8;
        decode += String.fromCharCode((bits >> bitCount) & 0xff);
      }
    }
    const parsed = JSON.parse(decode) as { app_metadata?: { brand_id?: unknown } };
    const brandId = parsed.app_metadata?.brand_id;
    return typeof brandId === 'string' && TENANT_UUID_PATTERN.test(brandId) ? brandId : null;
  } catch {
    return null;
  }
}
