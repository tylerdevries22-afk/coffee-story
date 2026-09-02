import type { Point } from './app-wall-geometry';

export type PointerSample = { readonly x: number; readonly y: number; readonly time: number };

/**
 * How far back a release looks to judge speed. A measurement window, not a
 * duration: shorter and a single jittery event decides the throw, longer and
 * the deceleration a hand makes before letting go is averaged away.
 */
export const VELOCITY_WINDOW_MS = 80;

export function pushSample(buffer: readonly PointerSample[], sample: PointerSample, windowMs = VELOCITY_WINDOW_MS): PointerSample[] {
  return [...buffer.filter((entry) => sample.time - entry.time <= windowMs), sample];
}

/** Pixels per second over the window, or zero when there is not enough recent history to say. */
export function estimateVelocity(buffer: readonly PointerSample[], now: number, windowMs = VELOCITY_WINDOW_MS): Point {
  const recent = buffer.filter((entry) => now - entry.time <= windowMs);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last || recent.length < 2) return { x: 0, y: 0 };
  const seconds = (last.time - first.time) / 1000;
  if (seconds <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds };
}
