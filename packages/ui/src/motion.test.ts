import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EASING, SPRING, duration, staggerDelay } from './motion';

describe('staggerDelay', () => {
  it('leaves the first item undelayed and steps the rest', () => {
    assert.equal(staggerDelay(0, 40), 0);
    assert.equal(staggerDelay(1, 40), 40);
    assert.equal(staggerDelay(3, 40), 120);
  });

  it('caps, so the last tile of a long first screen is not half a second late', () => {
    // A guest has already reached for tile twelve by then.
    assert.equal(staggerDelay(20, 40), 320);
    assert.equal(staggerDelay(20, 40, 200), 200);
  });

  it('treats a nonsense index or step as no delay rather than NaN', () => {
    assert.equal(staggerDelay(-2, 40), 0);
    assert.equal(staggerDelay(Number.NaN, 40), 0);
    assert.equal(staggerDelay(3, Number.NaN), 0);
  });
});

describe('duration', () => {
  it('is zero under reduced motion, so the end state still applies', () => {
    assert.equal(duration(360, true), 0);
    assert.equal(duration(360, false), 360);
  });

  it('never returns a negative or a NaN duration', () => {
    assert.equal(duration(-100, false), 0);
    assert.equal(duration(Number.NaN, false), 0);
  });
});

describe('EASING', () => {
  /**
   * `Easing.bezier` throws on an x outside [0, 1] -- a curve is a function of
   * time and cannot run backwards. Catching it here is far cheaper than
   * catching it on a kiosk.
   */
  it('keeps every curve a valid function of time', () => {
    for (const [name, curve] of Object.entries(EASING)) {
      assert.equal(curve.length, 4, `${name} needs four control points`);
      assert.ok(curve[0] >= 0 && curve[0] <= 1, `${name} x1 out of range`);
      assert.ok(curve[2] >= 0 && curve[2] <= 1, `${name} x2 out of range`);
    }
  });

  it('lets only the landing curve overshoot', () => {
    const overshoots = Object.entries(EASING)
      .filter(([, curve]) => curve[1] > 1 || curve[3] > 1)
      .map(([name]) => name);
    assert.deepEqual(overshoots, ['land']);
  });
});

describe('SPRING', () => {
  it('keeps every spring critically damped enough not to ring', () => {
    for (const [name, spring] of Object.entries(SPRING)) {
      assert.ok(spring.damping > 0, `${name} damping`);
      assert.ok(spring.stiffness > 0, `${name} stiffness`);
    }
  });

  it('makes a press the quickest of them, because a laggy tap reads as a dropped tap', () => {
    assert.ok(SPRING.press.stiffness > SPRING.settle.stiffness);
    assert.ok(SPRING.press.stiffness > SPRING.pop.stiffness);
  });

  it('turn is slightly underdamped, never bouncy', () => {
    // zeta = c / (2 * sqrt(k * m)); below 0.6 a frame would visibly ring,
    // above 0.75 the overshoot that sells the turn disappears.
    const zeta = SPRING.turn.damping / (2 * Math.sqrt(SPRING.turn.stiffness));
    assert.ok(zeta >= .6 && zeta <= .75, `zeta ${zeta}`);
  });
});
