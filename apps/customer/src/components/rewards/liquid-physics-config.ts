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
 * settles. The second mode adds chop on impact without ringing on.
 */
export const SLOSH_TUNING: SloshTuning = {
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

export const REST_SLOSH: SloshState = {
  tilt: 0,
  tiltVel: 0,
  a1: 0,
  v1: 0,
  a2: 0,
  v2: 0,
};
