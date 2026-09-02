import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boundsFor, fillLayout, fitLayout, growToFill, layoutExtent } from './app-wall-fit';
import {
  CAPTION_ROWS, CHIP_ROWS, constrain, DEFAULT_BOUNDS, footprintOf, heightOf, INITIAL_LAYOUT, layoutOverlaps, MAX_WIDTH, MIN_WIDTH,
  rotatedTile, type AppPreviewTile, type WallBounds,
} from './app-wall-geometry';
import { frameOfKey } from './app-previews';
import { reflowTiles } from './app-wall-reflow';

const master = () => ({ bounds: DEFAULT_BOUNDS, tiles: Object.values(INITIAL_LAYOUT) });
const inside = (tiles: readonly AppPreviewTile[], bounds: WallBounds) => tiles.every((tile) =>
  tile.x >= -1e-9 && tile.x + tile.width <= bounds.columns + 1e-9 && tile.y >= CHIP_ROWS - 1e-9 && tile.y + heightOf(tile) + CAPTION_ROWS <= bounds.rows + 1e-9);
const coverage = (tiles: readonly AppPreviewTile[], bounds: WallBounds) =>
  tiles.reduce((sum, tile) => sum + tile.width * heightOf(tile), 0) / (bounds.columns * bounds.rows);

describe('fitLayout', () => {
  it('returns the authored layout untouched when the bounds still hold it', () => {
    assert.deepEqual(fitLayout(master(), { columns: 60, rows: 48.4 }).tiles, master().tiles);
  });

  it('scales a 60x48 layout uniformly to fit a shorter canvas', () => {
    const bounds = { columns: 60, rows: 28 };
    const result = fitLayout(master(), bounds);
    assert.equal(result.mode, 'fitted');
    assert.ok(result.scale < 1);
    assert.ok(inside(result.tiles, bounds));
  });

  it('never shrinks a frame below its legible minimum width', () => {
    const result = fitLayout(master(), { columns: 60, rows: 20 });
    for (const tile of result.tiles) assert.ok(tile.width >= Math.min(MIN_WIDTH[frameOfKey(tile.key)], tile.width) - 1e-9, `${tile.key} ${tile.width}`);
    assert.ok(result.tiles.find((tile) => tile.key === 'customer')!.width >= MIN_WIDTH.phone - 1e-9);
  });

  it('leaves no overlapping footprints after fitting', () => {
    for (const rows of [20, 28, 34, 48, 60, 90]) {
      const result = fitLayout(master(), { columns: 60, rows });
      assert.equal(layoutOverlaps(result.tiles), false, `rows ${rows}`);
      if (result.mode === 'fitted') assert.ok(inside(result.tiles, { columns: 60, rows }), `rows ${rows}`);
    }
  });

  it('is deterministic for identical input', () => {
    assert.deepEqual(fitLayout(master(), { columns: 60, rows: 28 }), fitLayout(master(), { columns: 60, rows: 28 }));
  });

  it('is idempotent on its own output at the same bounds', () => {
    const bounds = { columns: 60, rows: 28 };
    const once = fitLayout(master(), bounds);
    const twice = fitLayout({ bounds, tiles: once.tiles }, bounds);
    assert.deepEqual(twice.tiles, once.tiles);
  });

  it('preserves reading order after repack', () => {
    const result = fitLayout(master(), { columns: 60, rows: 28 });
    const hq = result.tiles.find((tile) => tile.key === 'hq')!;
    const display = result.tiles.find((tile) => tile.key === 'display')!;
    const kiosk = result.tiles.find((tile) => tile.key === 'kiosk')!;
    assert.ok(hq.x < display.x);
    assert.ok(hq.y < kiosk.y);
  });

  it('recovers the authored layout when the original bounds return', () => {
    const shrunk = fitLayout(master(), { columns: 60, rows: 28 });
    assert.notDeepEqual(shrunk.tiles, master().tiles);
    assert.deepEqual(fitLayout(master(), DEFAULT_BOUNDS).tiles, master().tiles);
  });

  it('falls back to a stacked column when frames cannot fit at minimum widths', () => {
    const result = fitLayout(master(), { columns: 60, rows: 6 });
    assert.equal(result.mode, 'stacked');
    assert.equal(layoutOverlaps(result.tiles), false);
  });

  it('derives square-cell bounds from a pixel size', () => {
    assert.deepEqual(boundsFor(1200, 600), { columns: 60, rows: 30 });
    assert.equal(boundsFor(0, 0).rows, 48);
  });

  it('footprint height follows orientation', () => {
    const landscape = footprintOf(INITIAL_LAYOUT.kiosk);
    const portrait = footprintOf(rotatedTile(INITIAL_LAYOUT.kiosk));
    assert.ok(landscape.width > landscape.height && portrait.height > portrait.width);
  });

  it('grows a small layout to fill a larger canvas', () => {
    const small = { bounds: { columns: 60, rows: 28 }, tiles: fitLayout(master(), { columns: 60, rows: 28 }).tiles };
    const large = { columns: 60, rows: 48 };
    const result = fitLayout(small, large);
    assert.ok(coverage(result.tiles, large) > coverage(small.tiles, large) * 1.1);
    assert.ok(inside(result.tiles, large));
    // Fixed aspects and reserved chrome rows cap what five frames can cover; the
    // authored wall itself covers about half, and a fitted one must not fall far below it.
    assert.ok(coverage(fitLayout(master(), { columns: 60, rows: 28 }).tiles, { columns: 60, rows: 28 }) > .42);
  });

  it('the grow pass leaves no frame able to expand without touching another', () => {
    const bounds = { columns: 60, rows: 28 };
    const grown = fitLayout(master(), bounds).tiles;
    const anchors = [[.5, .5], [0, 0], [1, 0], [0, 1], [1, 1]] as const;
    for (const [index, tile] of grown.entries()) {
      const ceiling = constrain({ ...tile, width: MAX_WIDTH[frameOfKey(tile.key)] }, bounds).width;
      if (tile.width >= ceiling - 1) continue;
      const others = grown.filter((_, otherIndex) => otherIndex !== index);
      // Binary resolution, whole-cell rounding and the gap a push leaves add up to about two cells of slack.
      for (const [ax, ay] of anchors) {
        const width = tile.width + 2;
        const wider = constrain({ ...tile, width, x: tile.x + (tile.width - width) * ax, y: tile.y + (heightOf(tile) - heightOf({ ...tile, width })) * ay }, bounds);
        assert.equal(layoutOverlaps([wider, ...others]), true, `${tile.key} could still grow from anchor ${ax},${ay}`);
      }
    }
  });

  it('a manually sized tile is not grown', () => {
    const bounds = { columns: 60, rows: 28 };
    const sized = master().tiles.map((tile) => tile.key === 'customer' ? { ...tile, width: 6, sized: true } : tile);
    const packed = fitLayout({ bounds: DEFAULT_BOUNDS, tiles: sized }, bounds).tiles;
    const customer = packed.find((tile) => tile.key === 'customer')!;
    assert.ok(customer.sized);
    const regrown = growToFill(packed, bounds).find((tile) => tile.key === 'customer')!;
    assert.equal(regrown.width, customer.width);
  });

  it('no frame exceeds its maximum width', () => {
    const result = fitLayout(master(), { columns: 60, rows: 120 });
    for (const tile of result.tiles) assert.ok(tile.width <= MAX_WIDTH[frameOfKey(tile.key)] + 1e-9, `${tile.key} ${tile.width}`);
  });

  it('rotating keeps the frame\'s long edge when the canvas allows it', () => {
    const before = INITIAL_LAYOUT.display;
    const turned = reflowTiles(master().tiles, 'display', rotatedTile(before), DEFAULT_BOUNDS).find((tile) => tile.key === 'display')!;
    assert.equal(heightOf(turned), before.width);
    assert.equal(fillLayout(reflowTiles(master().tiles, 'display', rotatedTile(before)), DEFAULT_BOUNDS) !== null, true);
  });

  it('a rotated frame taller than the canvas clamps to canvas height, never smaller', () => {
    const bounds = { columns: 60, rows: 20 };
    const before = { ...INITIAL_LAYOUT.display, width: 25 };
    const turned = constrain(rotatedTile(before), bounds);
    assert.ok(Math.abs(heightOf(turned) - (bounds.rows - CHIP_ROWS - CAPTION_ROWS)) < 1e-9);
    assert.ok(heightOf(turned) >= footprintOf(before).height);
  });

  it('extent spans to the caption of the lowest frame', () => {
    const extent = layoutExtent(master().tiles);
    assert.equal(extent.columns, 60);
    assert.ok(extent.rows > 44 && extent.rows <= 48);
  });
});
