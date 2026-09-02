import assert from 'node:assert/strict';
import { test } from 'node:test';

import { beginResize, beginTurn, finishTurn, resizedFromCorner, updateResize, updateTurn } from './app-wall-gestures';
import { DEFAULT_BOUNDS, heightOf, INITIAL_LAYOUT, layoutOverlaps } from './app-wall-geometry';
import { beginDrag, createWallState, releaseDrag, settle, simulateWall, tileOf, updateDrag, wallAtRest, type Corner, type WallState } from './app-wall-sim';

const fresh = (reduced = false) => createWallState(Object.values(INITIAL_LAYOUT), DEFAULT_BOUNDS, reduced);
const untilSettled = (state: WallState) => {
  let current = state;
  for (let index = 0; index < 600 && current.active?.phase === 'coasting'; index += 1) current = simulateWall(current, 1 / 60, 1)[0]!;
  return current;
};

test('a full throw ends in a whole-cell, overlap-free layout', () => {
  let state = beginDrag(fresh(), 'customer');
  state = updateDrag(state, { x: -4, y: -2 }, { x: -40, y: -20 });
  state = releaseDrag(state, { x: -40, y: -20 });
  assert.equal(state.active?.phase, 'coasting');
  state = untilSettled(state);
  assert.equal(state.active?.phase, 'settling');
  const customer = tileOf(state, 'customer')!;
  assert.equal(customer.x, Math.round(customer.x));
  assert.equal(customer.y, Math.round(customer.y));
  assert.ok(customer.x < INITIAL_LAYOUT.customer.x - 4, 'coasted past the release point');
  assert.equal(layoutOverlaps(state.tiles), false);
  const idle = settle(state);
  assert.equal(idle.active, null);
});

test('hand-off carries residual velocity into the settle transition', () => {
  let state = releaseDrag(updateDrag(beginDrag(fresh(), 'customer'), { x: 0, y: -1 }, { x: 0, y: -30 }), { x: 0, y: -30 });
  state = untilSettled(state);
  assert.ok(state.handoff);
  assert.ok(Math.hypot(state.handoff.x, state.handoff.y) > 0);
});

test('a coast that would land on an occupied slot falls back to the nearest open one', () => {
  let state = releaseDrag(updateDrag(beginDrag(fresh(), 'customer'), { x: -6, y: 0 }, { x: -60, y: 0 }), { x: -60, y: 0 });
  state = untilSettled(state);
  assert.equal(layoutOverlaps(state.tiles), false);
  assert.equal(state.refused, false);
});

test('reduced motion snaps on release with no intermediate frames', () => {
  const state = releaseDrag(updateDrag(beginDrag(fresh(true), 'customer'), { x: -3.4, y: -1.6 }, { x: -50, y: -50 }), { x: -50, y: -50 });
  assert.equal(state.active?.phase, 'settling');
  assert.deepEqual(state.handoff, { x: 0, y: 0 });
  const customer = tileOf(state, 'customer')!;
  assert.deepEqual([customer.x, customer.y], [INITIAL_LAYOUT.customer.x - 3, INITIAL_LAYOUT.customer.y - 2]);
  assert.deepEqual(simulateWall(state, 1 / 60, 1)[0]!.kinetics, {});
});

test('a dragged tile presses the edge with a bounded give and the rest stays legal', () => {
  const state = updateDrag(beginDrag(fresh(), 'customer'), { x: 30, y: 0 }, { x: 0, y: 0 });
  const customer = tileOf(state, 'customer')!;
  assert.equal(customer.x + customer.width, 60);
  const give = state.kinetics.customer!.offset.x;
  assert.ok(give > 0 && give <= .6 + 1e-9);
});

test('rotate is refused when no open slot fits the rotated footprint', () => {
  const cramped = createWallState(Object.values(INITIAL_LAYOUT), { columns: 30, rows: 14 }, false);
  assert.equal(beginTurn(cramped, 'display'), null);
  assert.ok(beginTurn(fresh(), 'display'));
});

test('a turn reversed mid-flight still ends overlap-free', () => {
  let state = beginTurn(fresh(), 'kiosk')!;
  state = updateTurn(state, .35);
  assert.equal(layoutOverlaps(state.tiles), false);
  state = updateTurn(state, .6);
  state = finishTurn(state, .2);
  assert.equal(tileOf(state, 'kiosk')?.orientation, 'landscape');
  assert.equal(layoutOverlaps(state.tiles), false);
  state = settle(state);
  assert.equal(wallAtRest(simulateWall(state, 1 / 60, 240)[239]!), true);
});

test('a finished turn commits the rotated footprint with its long edge intact', () => {
  let state = beginTurn(fresh(), 'display')!;
  state = finishTurn(updateTurn(state, 1), 1);
  const display = tileOf(state, 'display')!;
  assert.equal(display.orientation, 'portrait');
  assert.ok(Math.abs(display.width * 1.72 - INITIAL_LAYOUT.display.width) < 1e-9);
  assert.equal(layoutOverlaps(state.tiles), false);
});

test('resizing from the north-west corner keeps the south-east corner fixed', () => {
  const state = updateResize(beginResize(fresh(), 'kiosk', 'nw'), { x: -3, y: -1 });
  const kiosk = tileOf(state, 'kiosk')!;
  const origin = INITIAL_LAYOUT.kiosk;
  assert.ok(kiosk.width > origin.width);
  assert.ok(Math.abs(kiosk.x + kiosk.width - (origin.x + origin.width)) < 1e-9);
  assert.ok(Math.abs(kiosk.y + heightOf(kiosk) - (origin.y + heightOf(origin))) < 1e-9);
});

test('every resize corner keeps its opposite corner fixed', () => {
  const origin = INITIAL_LAYOUT.kiosk;
  const corners: readonly [Corner, boolean, boolean][] = [['nw', true, true], ['ne', false, true], ['sw', true, false], ['se', false, false]];
  for (const [corner, lockRight, lockBottom] of corners) {
    const tile = resizedFromCorner(origin, origin.width + 3, corner);
    const right = Math.abs(tile.x + tile.width - (origin.x + origin.width)) < 1e-9;
    const bottom = Math.abs(tile.y + heightOf(tile) - (origin.y + heightOf(origin))) < 1e-9;
    assert.equal(lockRight ? right : Math.abs(tile.x - origin.x) < 1e-9, true);
    assert.equal(lockBottom ? bottom : Math.abs(tile.y - origin.y) < 1e-9, true);
  }
});

test('a refused placement still moves the dragged tile with the pointer', () => {
  const cramped = createWallState(Object.values(INITIAL_LAYOUT), { columns: 60, rows: 30 }, false);
  const state = updateDrag(beginDrag(cramped, 'hq'), { x: 20, y: 10 }, { x: 0, y: 0 });
  const hq = tileOf(state, 'hq')!;
  assert.ok(hq.x > INITIAL_LAYOUT.hq.x);
});

test('dragging below a full wall opens another row instead of clamping at the old edge', () => {
  const initial = fresh();
  const state = updateDrag(beginDrag(initial, 'customer'), { x: -10, y: 35 }, { x: 0, y: 0 });
  const customer = tileOf(state, 'customer')!;
  assert.ok(state.canvas.rows > initial.canvas.rows);
  assert.ok(customer.y > initial.canvas.rows - heightOf(customer));
  assert.equal(state.refused, false);
  assert.equal(layoutOverlaps(state.tiles), false);
});

test('a corner resize opens a new row when the existing rows cannot reflow', () => {
  const canvas = { columns: 60, rows: 40 };
  const initial = createWallState(Object.values(INITIAL_LAYOUT), canvas, false);
  const state = updateResize(beginResize(initial, 'hq', 'se'), { x: 11, y: 0 });
  assert.ok(state.canvas.rows > canvas.rows);
  assert.equal(state.refused, false);
  assert.equal(layoutOverlaps(state.tiles), false);
});
