import assert from 'node:assert/strict';
import test from 'node:test';

import { projectDragRelease } from './app-wall-physics';

const canvas = { height: 800, width: 1_000 };

test('projects a low-velocity release in its direction of travel', () => {
  const release = projectDragRelease({ offset: { x: 40, y: 20 }, velocity: { x: 500, y: -250 } }, canvas);
  assert.ok(release.x > 40 && release.x < 260);
  assert.ok(release.y < 20 && release.y > -156);
});

test('caps high-velocity inertia to a safe fraction of the canvas', () => {
  assert.deepEqual(
    projectDragRelease({ offset: { x: 20, y: 30 }, velocity: { x: 10_000, y: -10_000 } }, canvas),
    { x: 240, y: -146 },
  );
});

test('removes inertial travel when reduced motion is enabled', () => {
  assert.deepEqual(
    projectDragRelease({ offset: { x: 12, y: 16 }, velocity: { x: 2_000, y: 1_000 } }, canvas, true),
    { x: 12, y: 16 },
  );
});
