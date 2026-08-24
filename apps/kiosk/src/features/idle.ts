/**
 * The kiosk's idle clock.
 *
 * A lobby tablet is abandoned mid-order constantly -- someone changes their
 * mind, gets called, or just walks off -- and the next guest must never inherit
 * a stranger's session. Equally, a screen that resets while someone is deciding
 * between two drinks is worse than useless, so the timeout warns first and
 * gives them a way back.
 *
 * Two things changed when the flow became a guided one, and both were bugs:
 *
 * 1. The old predicate was `hasCart`. A guest four cookies into a six-pack has
 *    an empty *cart* and a great deal of progress, and the old clock treated
 *    them as an untouched attract screen -- it would never warn, and never
 *    clear what they left behind. `hasProgress` covers the builder too.
 * 2. There was no notion of a session past the point of no return. `IdleNotice`
 *    happened to be mounted only on the order screen, which hid it; a session
 *    abandoned at tender had its cart emptied at 90s underneath a live Pay
 *    button showing a real total. `committed` states the rule instead of
 *    relying on which screen renders the component.
 *
 * Timings come from the tenant (`brand_config.kiosk.idle`), because filling a
 * twelve-box takes longer than picking one latte.
 *
 * Pure, so the whole policy is testable without a renderer or a real clock.
 */
import { DEFAULT_KIOSK_FLOW } from '@platform/domain';

/** The platform's defaults, from the one place they are defined. */
export const IDLE_WARN_MS = DEFAULT_KIOSK_FLOW.idle.warnMs;
export const IDLE_RESET_MS = DEFAULT_KIOSK_FLOW.idle.resetMs;
export const DEFAULT_IDLE_TIMING: IdleTiming = { ...DEFAULT_KIOSK_FLOW.idle };

export type IdleTiming = { warnMs: number; resetMs: number };

export type IdleSubject = {
  /** Anything the next guest must not walk up to: a bag, or a half-built pack. */
  hasProgress: boolean;
  /** Payment is under way or done. A paid session is never cleared. */
  committed: boolean;
};

export type IdlePhase = 'active' | 'warning' | 'reset';

/**
 * Where the session stands, given how long since the guest last touched it.
 *
 * A session with nothing in it never warns: an attract screen nobody has
 * touched is the resting state, not an abandoned order, and counting it down
 * would blank a display every ninety seconds all day for no reason.
 */
export function idlePhase(idleMs: number, timing: IdleTiming, subject: IdleSubject): IdlePhase {
  if (subject.committed) return 'active';
  if (!subject.hasProgress) return 'active';
  const { warnMs, resetMs } = safeTiming(timing);
  if (idleMs >= resetMs) return 'reset';
  if (idleMs >= warnMs) return 'warning';
  return 'active';
}

/** Whole seconds left before the reset, for the countdown a guest reads. */
export function secondsUntilReset(idleMs: number, timing: IdleTiming = DEFAULT_IDLE_TIMING): number {
  return Math.max(0, Math.ceil((safeTiming(timing).resetMs - idleMs) / 1000));
}

/**
 * How far through the warning the session is, 0 to 1.
 *
 * Drives the countdown ring. Measured from the warning rather than from the
 * last touch, so the ring starts full at the moment the guest is first told
 * anything -- an arc that is already three-quarters gone when it appears reads
 * as a countdown that has been running behind their back.
 */
export function idleFraction(idleMs: number, timing: IdleTiming = DEFAULT_IDLE_TIMING): number {
  const { warnMs, resetMs } = safeTiming(timing);
  const window = resetMs - warnMs;
  if (window <= 0) return 1;
  return Math.min(1, Math.max(0, (idleMs - warnMs) / window));
}

/**
 * Timings arrive resolved from the tenant config, but this module is also
 * called with hand-built values in tests and by a caller that has not hydrated
 * yet. An inverted pair would otherwise reset before it warned.
 */
function safeTiming(timing: IdleTiming): IdleTiming {
  const warnMs = Number.isFinite(timing?.warnMs) && timing.warnMs > 0
    ? timing.warnMs : DEFAULT_IDLE_TIMING.warnMs;
  const resetMs = Number.isFinite(timing?.resetMs) && timing.resetMs > warnMs
    ? timing.resetMs : Math.max(DEFAULT_IDLE_TIMING.resetMs, warnMs + 1000);
  return { warnMs, resetMs };
}
