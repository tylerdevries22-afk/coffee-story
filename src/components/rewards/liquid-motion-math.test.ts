import assert from 'node:assert/strict';
import { test } from 'node:test';

import { screenGravityAngle } from './liquid-motion-math';

const G = 9.81;

test('an upright phone asks for a flat surface', () => {
  assert.ok(Math.abs(screenGravityAngle(0, -G, 0)) < 1e-9);
});

test('tilting the phone leans the surface the opposite way', () => {
  const right = screenGravityAngle(G * Math.sin(0.4), -G * Math.cos(0.4), 0);
  const left = screenGravityAngle(-G * Math.sin(0.4), -G * Math.cos(0.4), 0);
  assert.ok(Math.abs(Math.abs(right) - 0.4) < 1e-6, `expected 0.4 rad, got ${right}`);
  assert.equal(Math.sign(right), -Math.sign(left));
});

test('rotating the device is compensated rather than read as a lean', () => {
  // Held sideways, gravity runs along the device's x axis. In portrait that
  // would be a full 90-degree lean; once the reported orientation says the
  // device itself is turned, the surface must read as flat again.
  assert.ok(Math.abs(screenGravityAngle(G, 0, 0)) > 1.5, 'portrait baseline is not a lean');
  assert.ok(Math.abs(screenGravityAngle(G, 0, 90)) < 1e-6);
  assert.ok(Math.abs(screenGravityAngle(-G, 0, -90)) < 1e-6);
  assert.ok(Math.abs(screenGravityAngle(0, G, 180)) < 1e-6);
});

test('free fall gives no direction rather than a wild angle', () => {
  assert.equal(screenGravityAngle(0, 0, 0), 0);
  assert.equal(screenGravityAngle(0.4, -0.3, 0), 0);
});

test('the angle stays finite for any input', () => {
  for (const [x, y, o] of [
    [G, G, 0],
    [-G, G, 180],
    [0, G, 45],
    [G * 4, -G * 4, -90],
  ]) {
    assert.ok(Number.isFinite(screenGravityAngle(x, y, o)));
  }
});
