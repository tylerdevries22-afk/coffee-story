import { SPRING, type Bezier } from '@platform/ui/motion';

export type SpringPreset = keyof typeof SPRING;

export type SpringTransition =
  | { readonly type: 'spring'; readonly damping: number; readonly stiffness: number; readonly mass?: number; readonly restDelta: number; readonly restSpeed: number; readonly velocity?: number }
  | { readonly duration: 0 };

/** A quarter turn, in degrees. The wall rotates devices between two rest orientations only. */
export const TURN_DEGREES = 90;

/**
 * The one place a wall animation picks up a spring. Reduced motion collapses
 * to a zero duration rather than skipping the animation, so the end state is
 * still applied and a reduced-motion wall is the finished wall.
 */
export function springTransition(preset: SpringPreset, reduced: boolean, extra: { readonly velocity?: number } = {}): SpringTransition {
  if (reduced) return { duration: 0 };
  // Tight rest thresholds: a tile that is "done" a quarter pixel early is a
  // tile that never quite lands on its grid line.
  return { type: 'spring', ...SPRING[preset], restDelta: .001, restSpeed: .01, ...extra };
}

/** Formats an EASING tuple as the CSS function a stylesheet can consume. */
export function cubicBezierVar(curve: Bezier): string {
  return `cubic-bezier(${curve.join(', ')})`;
}
