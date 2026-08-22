import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scrimOpacity, sheetOffset } from './sheet-presentation';

const TARGET = 0.45;
const HEIGHT = 520;

test('the scrim starts fully clear, so an opening sheet cannot flash', () => {
  assert.equal(scrimOpacity(0, TARGET), 0);
});

test('the scrim settles exactly on its target strength', () => {
  assert.equal(scrimOpacity(1, TARGET), TARGET);
});

test('the scrim only ever fades -- it never reads the sheet geometry', () => {
  // The regression this file exists for: a scrim that knows about height is a
  // scrim that can be made to travel. `scrimOpacity` takes no geometry at all,
  // so the only way to reintroduce a sliding dim is to change its signature.
  assert.equal(scrimOpacity.length, 2);
  let previous = -1;
  for (let step = 0; step <= 20; step += 1) {
    const value = scrimOpacity(step / 20, TARGET);
    assert.ok(value > previous, `opacity must rise monotonically, stalled at ${step / 20}`);
    assert.ok(value >= 0 && value <= TARGET, `opacity ${value} escaped 0..${TARGET}`);
    previous = value;
  }
});

test('the sheet begins a full height below its resting place', () => {
  assert.equal(sheetOffset(0, HEIGHT), HEIGHT);
});

test('the sheet lands flush at full progress', () => {
  assert.equal(sheetOffset(1, HEIGHT), 0);
});

test('scrim and sheet share one clock', () => {
  // Halfway through the presentation both must be halfway through their own
  // range. Drifting curves are what made the old transition read as two
  // separate events instead of one.
  assert.equal(scrimOpacity(0.5, TARGET), TARGET / 2);
  assert.equal(sheetOffset(0.5, HEIGHT), HEIGHT / 2);
});

test('a sheet that has not been measured yet is still offscreen, never mid-air', () => {
  assert.equal(sheetOffset(0, 0), 0);
  assert.equal(sheetOffset(0, -40), 0, 'a negative height must not push the sheet upward');
});

test('progress outside 0..1 is clamped rather than overshooting the dim', () => {
  assert.equal(scrimOpacity(-0.5, TARGET), 0);
  assert.equal(scrimOpacity(1.8, TARGET), TARGET);
  assert.equal(sheetOffset(-0.5, HEIGHT), HEIGHT);
  assert.equal(sheetOffset(1.8, HEIGHT), 0);
});

test('a non-finite progress falls back to dismissed instead of NaN styles', () => {
  assert.equal(scrimOpacity(Number.NaN, TARGET), 0);
  assert.equal(sheetOffset(Number.NaN, HEIGHT), HEIGHT);
});
