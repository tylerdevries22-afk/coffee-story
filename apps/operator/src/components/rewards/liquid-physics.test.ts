import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REST_SLOSH,
  SLOSH_TUNING,
  dragToMotion,
  sloshEnergy,
  stepSlosh,
  surfaceOffsetAt,
  type SloshState,
} from './liquid-physics';

function run(state: SloshState, seconds: number, lateral: number, gravityAngle = 0, dt = 1 / 60) {
  let next = state;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    next = stepSlosh(next, { lateral, gravityAngle, dt });
  }
  return next;
}

test('a still container leaves the surface flat', () => {
  const settled = run(REST_SLOSH, 2, 0);
  assert.equal(settled.tilt, 0);
  assert.equal(settled.a1, 0);
  assert.equal(surfaceOffsetAt(0.3, settled), 0);
});

test('the surface finds level when the container is tilted', () => {
  const tilted = run(REST_SLOSH, 3, 0, 0.3);
  assert.ok(Math.abs(tilted.tilt - 0.3) < 0.01, `tilt settled at ${tilted.tilt}`);
});

test('the surface lags gravity rather than snapping to it', () => {
  const early = stepSlosh(REST_SLOSH, { lateral: 0, gravityAngle: 0.3, dt: 1 / 60 });
  assert.ok(early.tilt < 0.05, `tilt jumped straight to ${early.tilt}`);
  assert.ok(early.tilt > 0, 'tilt did not begin moving toward level');
});

test('tilt is clamped so the surface cannot leave the heart', () => {
  const extreme = run(REST_SLOSH, 4, 0, 5);
  assert.ok(Math.abs(extreme.tilt) <= SLOSH_TUNING.maxTilt + 1e-9);
});

test('a lateral shove raises a wave that then decays', () => {
  const shoved = run(REST_SLOSH, 0.12, 9);
  const peak = Math.abs(shoved.a1);
  assert.ok(peak > 1e-4, 'no wave was raised');

  const settled = run(shoved, 6, 0);
  assert.ok(Math.abs(settled.a1) < peak * 0.05, `wave still at ${settled.a1} after 6s`);
});

test('sustained shaking stays bounded instead of accumulating energy', () => {
  let state = REST_SLOSH;
  for (let i = 0; i < 600; i += 1) {
    // Drive right at the fundamental to hunt for runaway resonance.
    const lateral = 20 * Math.sin(SLOSH_TUNING.omega1 * (i / 60));
    state = stepSlosh(state, { lateral, gravityAngle: 0, dt: 1 / 60 });
  }
  assert.ok(Math.abs(state.a1) <= SLOSH_TUNING.maxAmp + 1e-9);
  assert.ok(Number.isFinite(state.v1), 'velocity diverged');
});

/**
 * Amplitude envelope of the fundamental. `a1` alone swings through zero every
 * half cycle, so only the envelope decays monotonically and is meaningful to
 * compare between two runs sampled at the same instant.
 */
function envelope(state: SloshState): number {
  return Math.hypot(state.a1, state.v1 / SLOSH_TUNING.omega1);
}

test('a choppy frame rate decays the same as a smooth one', () => {
  const shoved = run(REST_SLOSH, 0.12, 9);
  const smooth = run(shoved, 1, 0, 0, 1 / 60);
  // 24fps frames stay under the stall clamp, so both runs cover a full second
  // and only sub-stepping accounts for the difference.
  const choppy = run(shoved, 1, 0, 0, 1 / 24);

  assert.ok(envelope(smooth) < envelope(shoved), 'the wave did not decay');
  assert.ok(envelope(choppy) < envelope(shoved), 'choppy run gained amplitude');
  assert.ok(
    Math.abs(envelope(choppy) - envelope(smooth)) < envelope(shoved) * 0.1,
    `envelopes diverged: ${envelope(choppy)} vs ${envelope(smooth)}`,
  );
});

test('a stall is treated as lost time rather than one huge step', () => {
  const shoved = run(REST_SLOSH, 0.12, 9);
  // A single 2s frame must advance at most MAX_DT, so the liquid picks up
  // roughly where it left off instead of teleporting to settled.
  const stalled = stepSlosh(shoved, { lateral: 0, gravityAngle: 0, dt: 2 });
  const oneStep = stepSlosh(shoved, { lateral: 0, gravityAngle: 0, dt: 0.05 });
  assert.ok(Math.abs(envelope(stalled) - envelope(oneStep)) < 1e-9);
});

test('an absurd timestep is treated as a gap, not integrated', () => {
  const jumped = stepSlosh(REST_SLOSH, { lateral: 12, gravityAngle: 0.2, dt: 30 });
  assert.ok(Number.isFinite(jumped.tilt) && Math.abs(jumped.tilt) <= SLOSH_TUNING.maxTilt);
  assert.ok(Number.isFinite(jumped.a1));
});

test('a zero or negative timestep is a no-op', () => {
  assert.deepEqual(stepSlosh(REST_SLOSH, { lateral: 5, gravityAngle: 1, dt: 0 }), REST_SLOSH);
  assert.deepEqual(stepSlosh(REST_SLOSH, { lateral: 5, gravityAngle: 1, dt: -1 }), REST_SLOSH);
});

test('every mode conserves volume across the container', () => {
  const state: SloshState = { tilt: 0.3, tiltVel: 0, a1: 0.08, v1: 0, a2: -0.05, v2: 0 };
  // Midpoint-rule integral of the surface offset over [-0.5, 0.5].
  const samples = 2000;
  let area = 0;
  for (let i = 0; i < samples; i += 1) {
    area += surfaceOffsetAt(-0.5 + (i + 0.5) / samples, state) / samples;
  }
  assert.ok(Math.abs(area) < 1e-9, `net displaced volume was ${area}`);
});

test('the surface leans the way the container is tilted', () => {
  const state: SloshState = { ...REST_SLOSH, tilt: 0.3 };
  assert.ok(surfaceOffsetAt(0.5, state) > 0);
  assert.ok(surfaceOffsetAt(-0.5, state) < 0);
});

test('energy reports calm at rest and saturates when thrashed', () => {
  assert.equal(sloshEnergy(REST_SLOSH), 0);
  const violent: SloshState = {
    ...REST_SLOSH,
    a1: SLOSH_TUNING.maxAmp,
    a2: SLOSH_TUNING.maxAmp,
    v1: 99,
    v2: 99,
  };
  assert.equal(sloshEnergy(violent), 1);
});

test('drag maps to bounded tilt and lateral forcing', () => {
  const gentle = dragToMotion(40, 200);
  assert.ok(gentle.gravityAngle > 0 && gentle.lateral > 0);

  const slammed = dragToMotion(100000, 100000);
  assert.ok(Math.abs(slammed.gravityAngle) <= 0.34);
  assert.ok(Math.abs(slammed.lateral) <= 22);
});
