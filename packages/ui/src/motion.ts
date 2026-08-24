/**
 * The motion contract: curves, springs, and the one branch that turns an
 * animation off.
 *
 * Durations are tokens (`tokens.motion.*`) because a tenant may tune them.
 * Curves are not: an easing is a statement about how this platform moves, the
 * same way the type ladder is a statement about how it reads, and a tenant
 * handing us four arbitrary control points can only make the product feel
 * broken. docs/DESIGN.md calls motion "furniture, not fireworks" -- this is
 * the furniture.
 *
 * Deliberately free of any react-native import, so `node:test` reaches it the
 * way it reaches `menu-image.ts`. Curves are exported as bezier TUPLES, not as
 * `Easing` objects; the app calls `Easing.bezier(...EASING.enter)` at the site.
 * That keeps this package from taking a dependency on an animation runtime.
 */

/** Control points for a cubic bezier, in the order `Easing.bezier` wants them. */
export type Bezier = readonly [number, number, number, number];

export const EASING = {
  /** Things arriving. Decelerates hard, so an entrance settles rather than stops. */
  enter: [0.16, 1, 0.3, 1] as Bezier,
  /** Things leaving. Accelerates: nobody needs to watch an exit finish. */
  exit: [0.7, 0, 0.84, 0] as Bezier,
  /** Things travelling between two known places -- a choice flying to its slot. */
  move: [0.65, 0, 0.35, 1] as Bezier,
  /**
   * The one curve that overshoots. Reserved for a thing landing in a
   * container, because the overshoot is what makes it read as landing rather
   * than as being placed.
   */
  land: [0.34, 1.3, 0.64, 1] as Bezier,
} as const;

/** Spring configs, in the shape `withSpring` takes. */
export const SPRING = {
  /** A press. Stiff and short: a tap that visibly lags reads as a dropped tap. */
  press: { damping: 18, stiffness: 420, mass: 0.6 },
  /** Coming back to rest after a press or a drag. */
  settle: { damping: 22, stiffness: 220 },
  /** A thing appearing with a little life -- a slot filling, a badge bumping. */
  pop: { damping: 12, stiffness: 320 },
} as const;

/**
 * The delay for item `index` in a staggered entrance.
 *
 * Capped, because a stagger is a reading order cue, not a queue: without a cap
 * the twelfth tile on a kiosk's first screen arrives half a second after the
 * first, and a guest has already reached for it.
 */
export function staggerDelay(index: number, step: number, cap = 320): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 0;
  return Math.min(cap, Math.round(index) * safeStep);
}

/**
 * A duration, or zero when the guest has asked for less motion.
 *
 * The single branch every animation in the tree goes through. Zero rather than
 * "skip the animation" on purpose: the end state is still applied, so a
 * reduced-motion screen is the finished screen, never a screen missing the
 * thing the animation was going to reveal.
 */
export function duration(ms: number, reduced: boolean): number {
  if (reduced) return 0;
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}
