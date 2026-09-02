import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAPTION_ROWS, DEFAULT_BOUNDS, heightOf, INITIAL_LAYOUT } from './app-wall-geometry';
import { addWallRow, expandWallRows, MAX_WALL_ROWS, rowsForPlacement, wallRowHeight } from './app-wall-rows';

const tiles = Object.values(INITIAL_LAYOUT);

describe('expandable wall rows', () => {
  it('sizes a logical row for the tallest device and its reserved chrome', () => {
    assert.ok(wallRowHeight(tiles) > Math.max(...tiles.map((tile) => heightOf(tile))) + CAPTION_ROWS);
  });

  it('adds only whole logical rows', () => {
    const one = addWallRow(DEFAULT_BOUNDS, tiles);
    const many = expandWallRows(DEFAULT_BOUNDS, tiles, one.rows + 1);
    assert.equal(one.rows, DEFAULT_BOUNDS.rows + wallRowHeight(tiles));
    assert.equal(many.rows, DEFAULT_BOUNDS.rows + wallRowHeight(tiles) * 2);
  });

  it('opens enough rows for a device dragged below the current wall', () => {
    const candidate = { ...INITIAL_LAYOUT.customer, y: 90 };
    const expanded = rowsForPlacement(DEFAULT_BOUNDS, tiles, candidate);
    assert.ok(expanded.rows >= candidate.y + heightOf(candidate) + CAPTION_ROWS);
  });

  it('caps expansion from extreme input', () => {
    assert.equal(expandWallRows(DEFAULT_BOUNDS, tiles, Number.POSITIVE_INFINITY).rows, MAX_WALL_ROWS);
    assert.equal(addWallRow({ ...DEFAULT_BOUNDS, rows: MAX_WALL_ROWS }, tiles).rows, MAX_WALL_ROWS);
  });
});
