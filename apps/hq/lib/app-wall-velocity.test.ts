import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateVelocity, pushSample, VELOCITY_WINDOW_MS } from './app-wall-velocity';

test('estimates px per second from recent samples', () => {
  let buffer = pushSample([], { x: 0, y: 0, time: 1000 });
  buffer = pushSample(buffer, { x: 20, y: -10, time: 1040 });
  assert.deepEqual(estimateVelocity(buffer, 1040), { x: 500, y: -250 });
});

test('ignores samples older than the window', () => {
  let buffer = pushSample([], { x: 0, y: 0, time: 0 });
  buffer = pushSample(buffer, { x: 100, y: 0, time: 500 });
  buffer = pushSample(buffer, { x: 110, y: 0, time: 520 });
  assert.equal(buffer.length, 2);
  assert.deepEqual(estimateVelocity(buffer, 520), { x: 500, y: 0 });
  assert.deepEqual(estimateVelocity(buffer, 520 + VELOCITY_WINDOW_MS + 1), { x: 0, y: 0 });
});

test('a single sample is zero velocity', () => {
  assert.deepEqual(estimateVelocity(pushSample([], { x: 5, y: 5, time: 10 }), 10), { x: 0, y: 0 });
  assert.deepEqual(estimateVelocity([{ x: 0, y: 0, time: 10 }, { x: 9, y: 9, time: 10 }], 10), { x: 0, y: 0 });
});
