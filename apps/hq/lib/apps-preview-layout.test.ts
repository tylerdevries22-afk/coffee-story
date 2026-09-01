import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INITIAL_LAYOUT, reflowTiles, tilesOverlap } from '../components/apps-preview-layout';

describe('reflowTiles', () => {
  it('places the dragged app at its target and settles every other app without collisions', () => {
    const tiles = Object.values(INITIAL_LAYOUT);
    const moved = reflowTiles(tiles, 'hq', { ...INITIAL_LAYOUT.hq, x: 30, y: 3 });

    assert.equal(moved.find((tile) => tile.key === 'hq')?.x, 30);
    assert.deepEqual(moved.map((tile) => tile.key), tiles.map((tile) => tile.key));
    assert.equal(new Set(moved.map((tile) => tile.key)).size, tiles.length);
    assert.equal(moved.some((tile, index) => moved.slice(index + 1).some((other) => tilesOverlap(tile, other))), false);
  });

  it('counts each app header in the collision footprint', () => {
    assert.equal(tilesOverlap(
      { key: 'hq', x: 2, y: 10, width: 12 },
      { key: 'display', x: 2, y: 7, width: 12 },
    ), true);
  });

  it('reserves the control area beneath each device as part of the collision footprint', () => {
    assert.equal(tilesOverlap(
      { key: 'hq', x: 2, y: 10, width: 12 },
      { key: 'display', x: 2, y: 22, width: 12 },
    ), true);
  });

  it('starts with a collision-free device wall', () => {
    const tiles = Object.values(INITIAL_LAYOUT);
    assert.equal(tiles.some((tile, index) => tiles.slice(index + 1).some((other) => tilesOverlap(tile, other))), false);
  });

  it('keeps fractional drag positions while the pointer is in motion', () => {
    const tiles = Object.values(INITIAL_LAYOUT);
    const moved = reflowTiles(tiles, 'hq', { ...INITIAL_LAYOUT.hq, x: 2.25, y: 4.25 });

    assert.equal(moved.find((tile) => tile.key === 'hq')?.x, 2.25);
    assert.equal(moved.find((tile) => tile.key === 'hq')?.y, 4.25);
  });

  it('allows a live resize while keeping every device collision-free', () => {
    const tiles = Object.values(INITIAL_LAYOUT);
    const resized = reflowTiles(tiles, 'customer', { ...INITIAL_LAYOUT.customer, width: 8.5 });

    assert.equal(resized.find((tile) => tile.key === 'customer')?.width, 8.5);
    assert.equal(resized.some((tile, index) => resized.slice(index + 1).some((other) => tilesOverlap(tile, other))), false);
  });

  it('keeps the prior layout when a drop cannot fit every device', () => {
    const tiles = Object.values(INITIAL_LAYOUT);
    assert.deepEqual(reflowTiles(tiles, 'hq', { ...INITIAL_LAYOUT.hq, width: 35, x: 0, y: 3 }), tiles);
  });

  it('keeps every card collision-free across a continuous drag path', () => {
    let current = Object.values(INITIAL_LAYOUT);
    const path: ReadonlyArray<readonly [number, number]> = [[5, 5], [12, 8], [20, 11], [28, 14], [34, 18]];
    for (const [x, y] of path) {
      const active = current.find((tile) => tile.key === 'hq');
      assert.ok(active);
      current = reflowTiles(current, 'hq', { ...active, x, y });
      assert.equal(current.some((tile, index) => current.slice(index + 1).some((other) => tilesOverlap(tile, other))), false);
    }
  });
});
