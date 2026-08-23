/**
 * The kiosk's idle clock.
 *
 * A lobby tablet is abandoned mid-order constantly -- someone changes their
 * mind, gets called, or just walks off -- and the next guest must never inherit
 * a stranger's bag. Equally, a screen that resets while someone is deciding
 * between two drinks is worse than useless, so the timeout warns first and
 * gives them a way back.
 *
 * Pure, so the whole policy is testable without a renderer or a real clock.
 */
export const IDLE_WARN_MS = 60_000;
export const IDLE_RESET_MS = 90_000;

export type IdlePhase = 'active' | 'warning' | 'reset';

/**
 * Where the session stands, given how long since the guest last touched it.
 *
 * An empty bag never warns: an attract screen nobody has touched is the resting
 * state, not an abandoned order, and counting it down would blank a display
 * every ninety seconds all day for no reason.
 */
export function idlePhase(idleMs: number, hasCart: boolean): IdlePhase {
  if (!hasCart) return 'active';
  if (idleMs >= IDLE_RESET_MS) return 'reset';
  if (idleMs >= IDLE_WARN_MS) return 'warning';
  return 'active';
}

/** Whole seconds left before the reset, for the countdown a guest reads. */
export function secondsUntilReset(idleMs: number): number {
  return Math.max(0, Math.ceil((IDLE_RESET_MS - idleMs) / 1000));
}
