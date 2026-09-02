import assert from 'node:assert/strict';
import { test } from 'node:test';

import { elasticClamp, projectedRest, shouldHandOff, snapToGrid, startCoast, stepCoast, WALL_PHYSICS } from './app-wall-coast';

const limits = { minX: 0, maxX: 40, minY: 1, maxY: 30 };
const run = (velocity: { x: number; y: number }, steps = 240) => {
  let state = startCoast({ position: { x: 20, y: 10 }, velocity }, false)!;
  const path = [state];
  for (let index = 0; index < steps; index += 1) { state = stepCoast(state, limits, 1 / 120).state; path.push(state); }
  return path;
};

test('a release below the coast threshold does not coast', () => {
  assert.equal(startCoast({ position: { x: 1, y: 1 }, velocity: { x: 2, y: 1 } }, false), null);
});

test('equal inputs produce identical trajectories', () => {
  assert.deepEqual(run({ x: 30, y: -12 }), run({ x: 30, y: -12 }));
});

test('speed decays monotonically on an open canvas', () => {
  const speeds = run({ x: 12, y: 0 }, 60).map((state) => Math.hypot(state.velocity.x, state.velocity.y));
  for (let index = 1; index < speeds.length; index += 1) assert.ok(speeds[index]! <= speeds[index - 1]! + 1e-9);
});

test('initial speed is capped so travel never exceeds MAX_COAST_CELLS', () => {
  const start = startCoast({ position: { x: 0, y: 0 }, velocity: { x: 900, y: 0 } }, false)!;
  assert.ok(Math.abs(start.velocity.x / WALL_PHYSICS.COAST_DECAY - WALL_PHYSICS.MAX_COAST_CELLS) < 1e-9);
  const path = run({ x: 900, y: 0 }, 600);
  const travelled = path[path.length - 1]!.position.x - 20;
  assert.ok(travelled <= WALL_PHYSICS.MAX_COAST_CELLS + 1e-6);
});

test('a throw into the left edge reflects with restitution and stays in bounds', () => {
  const state = { position: { x: .1, y: 10 }, velocity: { x: -60, y: 0 } };
  const { state: next, hits } = stepCoast(state, limits, 1 / 60);
  assert.equal(next.position.x, 0);
  assert.ok(next.velocity.x > 0);
  assert.ok(Math.abs(next.velocity.x) < 60 * WALL_PHYSICS.EDGE_RESTITUTION + 1e-9);
  assert.deepEqual(hits.map((hit) => [hit.axis, hit.direction]), [['x', -1]]);
});

test('projectedRest is clamped to bounds', () => {
  assert.deepEqual(projectedRest({ position: { x: 38, y: 10 }, velocity: { x: 60, y: -600 } }, limits), { x: 40, y: 1 });
});

test('hand-off triggers within HANDOFF_CELLS of the projected rest', () => {
  assert.equal(shouldHandOff({ position: { x: 10, y: 10 }, velocity: { x: 4, y: 0 } }, limits), true);
  assert.equal(shouldHandOff({ position: { x: 10, y: 10 }, velocity: { x: 40, y: 0 } }, limits), false);
});

test('reduced motion never coasts', () => {
  assert.equal(startCoast({ position: { x: 1, y: 1 }, velocity: { x: 50, y: 50 } }, true), null);
});

test('snapToGrid rounds to whole cells', () => {
  assert.deepEqual(snapToGrid({ x: 3.4, y: 7.6 }), { x: 3, y: 8 });
});

test('elasticClamp saturates at the give', () => {
  assert.equal(elasticClamp(5, 0, 10, .6), 5);
  assert.ok(elasticClamp(-100, 0, 10, .6) >= -.6 && elasticClamp(-100, 0, 10, .6) < -.59);
  assert.ok(elasticClamp(10.2, 0, 10, .6) > 10 && elasticClamp(10.2, 0, 10, .6) < 10.2);
});
