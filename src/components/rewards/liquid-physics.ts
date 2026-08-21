/**
 * Sloshing model for the rewards glass heart.
 *
 * Rather than simulate a full height field, the free surface is decomposed into
 * the modes that actually dominate liquid sloshing in a small container: a
 * tilting plane that chases gravity, plus the first two antisymmetric standing
 * waves. Each mode is an independent damped harmonic oscillator driven by the
 * container's lateral acceleration, which is the textbook linear sloshing
 * result and is unconditionally stable at any frame rate — a height field of
 * this resolution would need a CFL-limited timestep to avoid exploding when a
 * frame is dropped.
 *
 * Every mode shape is an odd function of the across-container coordinate, so
 * each one integrates to zero and the liquid volume is conserved exactly no
 * matter how violently it is shaken.
 *
 * Kept free of Reanimated and expo-sensors imports so it stays unit-testable
 * under node:test.
 */

export type SloshState = {
  /** Surface tilt in the container's frame, radians. */
  tilt: number;
  tiltVel: number;
  /** Amplitude of the fundamental (one-node) sloshing mode, normalized. */
  a1: number;
  v1: number;
  /** Amplitude of the second (two-node) mode, normalized. */
  a2: number;
  v2: number;
};

export type SloshInput = {
  /** Container acceleration across the screen, m/s^2, gravity excluded. */
  lateral: number;
  /** Where level lies in the container's frame, radians. */
  gravityAngle: number;
  /** Seconds since the previous step. */
  dt: number;
};

export type SloshTuning = {
  omega1: number;
  zeta1: number;
  omega2: number;
  zeta2: number;
  omegaTilt: number;
  zetaTilt: number;
  drive1: number;
  drive2: number;
  maxTilt: number;
  maxAmp: number;
};

/**
 * Tuned for a heavy, syrupy liquid rather than water: a ~1.6 Hz fundamental
 * with light damping keeps two or three visible swings after a shake before it
 * settles. The second mode sits near the 1.7x ratio a rectangular tank gives
 * and is damped harder, so it adds chop on impact without ringing on.
 */
export const SLOSH_TUNING: SloshTuning = {
  omega1: 10.0,
  zeta1: 0.11,
  omega2: 17.5,
  zeta2: 0.16,
  // The surface plane is heavily damped: liquid finds level with a little
  // overshoot, it does not oscillate about it like a pendulum.
  omegaTilt: 9.0,
  zetaTilt: 0.55,
  drive1: 0.085,
  drive2: 0.03,
  // Clamps keep the surface inside the heart's lobes at any provocation.
  maxTilt: 0.42,
  maxAmp: 0.09,
};

export const REST_SLOSH: SloshState = { tilt: 0, tiltVel: 0, a1: 0, v1: 0, a2: 0, v2: 0 };

/** Longest sub-step the integrator will take, seconds (~120 Hz). */
const MAX_SUB_DT = 0.008;
/** A stall longer than this is treated as a gap, not a huge timestep. */
const MAX_DT = 0.05;

function clamp(value: number, limit: number): number {
  'worklet';
  return value < -limit ? -limit : value > limit ? limit : value;
}

/**
 * Advances the surface by `dt` using semi-implicit Euler.
 *
 * Sub-steps so that a long frame is integrated as several short ones: a single
 * large step through a stiff oscillator gains energy instead of losing it, and
 * the liquid would visibly grow rather than settle after a dropped frame.
 */
export function stepSlosh(
  state: SloshState,
  input: SloshInput,
  tuning?: SloshTuning,
): SloshState {
  'worklet';
  // Reanimated serializes worklets independently from the module scope. A
  // default parameter that points at SLOSH_TUNING therefore becomes a missing
  // runtime property on native, while the same pure function works under
  // node:test. Keep the fallback literal inside the worklet and retain the
  // exported tuning object for callers/tests outside Reanimated.
  const config = tuning ?? {
    omega1: 10.0,
    zeta1: 0.11,
    omega2: 17.5,
    zeta2: 0.16,
    omegaTilt: 9.0,
    zetaTilt: 0.55,
    drive1: 0.085,
    drive2: 0.03,
    maxTilt: 0.42,
    maxAmp: 0.09,
  };
  const dt = input.dt > MAX_DT ? MAX_DT : input.dt > 0 ? input.dt : 0;
  if (dt === 0) return state;

  const count = Math.ceil(dt / MAX_SUB_DT);
  const h = dt / count;
  const level = clamp(input.gravityAngle, config.maxTilt);

  let { tilt, tiltVel, a1, v1, a2, v2 } = state;
  for (let step = 0; step < count; step += 1) {
    const tiltAcc =
      -config.omegaTilt * config.omegaTilt * (tilt - level) -
      2 * config.zetaTilt * config.omegaTilt * tiltVel;
    tiltVel += tiltAcc * h;
    tilt += tiltVel * h;

    const acc1 =
      -config.omega1 * config.omega1 * a1 -
      2 * config.zeta1 * config.omega1 * v1 +
      config.drive1 * input.lateral;
    v1 += acc1 * h;
    a1 += v1 * h;

    const acc2 =
      -config.omega2 * config.omega2 * a2 -
      2 * config.zeta2 * config.omega2 * v2 +
      config.drive2 * input.lateral;
    v2 += acc2 * h;
    a2 += v2 * h;
  }

  return {
    tilt: clamp(tilt, config.maxTilt),
    tiltVel,
    a1: clamp(a1, config.maxAmp),
    v1,
    a2: clamp(a2, config.maxAmp),
    v2,
  };
}

/**
 * Surface height offset at `u`, the across-container coordinate in [-0.5, 0.5],
 * as a fraction of container width. Positive is downward in screen space.
 *
 * All three terms are odd in `u`, so the offsets cancel across the container and
 * the enclosed area — the liquid volume — never changes.
 */
export function surfaceOffsetAt(u: number, state: SloshState): number {
  'worklet';
  return (
    u * state.tilt +
    state.a1 * Math.sin(Math.PI * u) +
    state.a2 * Math.sin(2 * Math.PI * u)
  );
}

/**
 * How agitated the surface is right now, roughly 0..1. Drives the secondary
 * effects (ripple depth, sparkle churn) so they respond to real motion instead
 * of running on a fixed loop.
 */
export function sloshEnergy(state: SloshState, tuning?: SloshTuning): number {
  'worklet';
  const maxAmp = tuning?.maxAmp ?? 0.09;
  const omega1 = tuning?.omega1 ?? 10.0;
  const amp = (Math.abs(state.a1) + Math.abs(state.a2)) / (2 * maxAmp);
  const vel = (Math.abs(state.v1) + Math.abs(state.v2)) / (2 * maxAmp * omega1);
  const energy = amp + vel;
  return energy > 1 ? 1 : energy;
}

/**
 * Converts a pan gesture into the same forcing the accelerometer supplies, so
 * dragging the heart sloshes it identically on hardware without motion access
 * and in the simulator. Displacement leans the surface; the speed of the drag
 * is what actually throws the liquid.
 */
export function dragToMotion(translationX: number, velocityX: number) {
  'worklet';
  return {
    gravityAngle: clamp(translationX / 260, 0.34),
    lateral: clamp(velocityX / 90, 22),
  };
}
