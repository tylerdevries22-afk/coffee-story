/**
 * The staff PIN latch: a shift-floor privacy screen, not an auth boundary --
 * the account session is the auth boundary. The PIN itself lives in
 * SecureStore (hardware-backed); this module owns the rules around it.
 */

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export const MAX_PIN_ATTEMPTS = 5;

/** Seconds the pad locks after too many misses; doubles per extra miss. */
export function lockoutSeconds(missCount: number): number {
  if (missCount < MAX_PIN_ATTEMPTS) return 0;
  return Math.min(30 * 2 ** (missCount - MAX_PIN_ATTEMPTS), 900);
}

export type PinState = {
  missCount: number;
  lockedUntil: string | null; // ISO
};

export function recordMiss(state: PinState, now: Date): PinState {
  const missCount = state.missCount + 1;
  const seconds = lockoutSeconds(missCount);
  return {
    missCount,
    lockedUntil: seconds > 0 ? new Date(now.getTime() + seconds * 1000).toISOString() : null,
  };
}

export function isLockedOut(state: PinState, now: Date): boolean {
  return state.lockedUntil !== null && new Date(state.lockedUntil) > now;
}

export function recordSuccess(): PinState {
  return { missCount: 0, lockedUntil: null };
}
