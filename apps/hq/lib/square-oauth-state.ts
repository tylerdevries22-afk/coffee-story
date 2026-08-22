/**
 * The `state` that round-trips through Square's OAuth consent.
 *
 * It used to carry the location id and a MAC over it, and nothing else. That
 * was enough to prove the id had not been edited in flight — and nothing
 * else at all: the value never expired, was not tied to whoever asked for
 * it, and the route that minted it asked for no credentials. Anyone could
 * request a valid state for any location id (they are readable by the anon
 * key) and connect their own Square merchant account to another brand's
 * shop, taking that shop's card payments.
 *
 * So state now binds three things — which location, which signed-in user,
 * and until when — and the MAC covers all of them together. The callback
 * re-checks the user still holds the session and still manages the location,
 * so a captured state is worthless to anyone else and worthless later.
 *
 * Pure functions, no I/O: the callers supply the secret and the clock.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
/** Long enough to finish a consent screen, short enough that a leaked URL dies. */
export const STATE_TTL_SECONDS = 15 * 60;

export type OAuthState = {
  locationId: string;
  userId: string;
  /** Unix seconds. */
  expiresAt: number;
};

function macOf(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function encodeOAuthState(secret: string, state: OAuthState): string {
  const payload = `${VERSION}.${state.locationId}.${state.userId}.${state.expiresAt}`;
  return `${payload}.${macOf(secret, payload)}`;
}

export type StateFailure = 'malformed' | 'bad_signature' | 'expired';

/**
 * Returns the state, or why it is not usable. The signature is checked before
 * the expiry so a tampered value never reports "expired" (which would tell an
 * attacker the MAC was accepted).
 */
export function decodeOAuthState(
  secret: string,
  raw: string,
  nowSeconds: number,
): { ok: true; state: OAuthState } | { ok: false; reason: StateFailure } {
  const parts = raw.split('.');
  if (parts.length !== 5) return { ok: false, reason: 'malformed' };
  const [version, locationId, userId, expiresRaw, mac] = parts as [string, string, string, string, string];
  if (version !== VERSION || !locationId || !userId || !/^\d+$/.test(expiresRaw)) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = macOf(secret, `${version}.${locationId}.${userId}.${expiresRaw}`);
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: 'bad_signature' };
  }
  const expiresAt = Number(expiresRaw);
  if (expiresAt <= nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, state: { locationId, userId, expiresAt } };
}
