import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  constrain, DEFAULT_BOUNDS, footprintAspect, footprintOf, FRAME_ASPECT, INITIAL_LAYOUT, layoutOverlaps, lerpFootprint,
  rotatedTile, tilesOverlap, wallBounds, type AppPreviewTile,
} from './app-wall-geometry';

const tile = (partial: Partial<AppPreviewTile> & Pick<AppPreviewTile, 'key' | 'x' | 'y' | 'width'>): AppPreviewTile =>
  ({ orientation: 'landscape', sized: false, ...partial });

describe('app wall geometry', () => {
  it('counts each app header in the collision footprint', () => {
    assert.equal(tilesOverlap(tile({ key: 'hq', x: 2, y: 10, width: 12 }), tile({ key: 'display', x: 2, y: 7, width: 12 })), true);
  });

  it('reserves the control area beneath each device as part of the collision footprint', () => {
    assert.equal(tilesOverlap(tile({ key: 'hq', x: 2, y: 10, width: 12 }), tile({ key: 'display', x: 2, y: 22, width: 12 })), true);
  });

  it('starts with a collision-free device wall', () => {
    assert.equal(layoutOverlaps(Object.values(INITIAL_LAYOUT)), false);
  });

  it('a portrait footprint inverts the frame aspect', () => {
    assert.equal(footprintAspect('tablet', 'portrait'), 1 / FRAME_ASPECT.tablet);
    const portrait = footprintOf(tile({ key: 'kiosk', x: 0, y: 0, width: 10, orientation: 'portrait' }));
    assert.ok(portrait.height > portrait.width);
  });

  it('rotating keeps the device centre and swaps the footprint', () => {
    const before = tile({ key: 'display', x: 10, y: 10, width: 17.2 });
    const after = rotatedTile(before);
    const beforeSize = footprintOf(before);
    const afterSize = footprintOf(after);
    assert.equal(after.orientation, 'portrait');
    assert.ok(Math.abs(afterSize.width - beforeSize.height) < 1e-9);
    assert.ok(Math.abs(afterSize.height - beforeSize.width) < 1e-9);
    assert.ok(Math.abs((before.x + beforeSize.width / 2) - (after.x + afterSize.width / 2)) < 1e-9);
    assert.ok(Math.abs((before.y + beforeSize.height / 2) - (after.y + afterSize.height / 2)) < 1e-9);
    assert.deepEqual(footprintOf(rotatedTile(after)), beforeSize);
  });

  it('wall bounds reserve the chip and caption rows', () => {
    const limits = wallBounds({ width: 10, height: 5 }, { columns: 60, rows: 30 });
    assert.deepEqual(limits, { minX: 0, maxX: 50, minY: 1, maxY: 23 });
  });

  it('constrain clamps a portrait footprint against the supplied bounds rather than a fixed 48 rows', () => {
    const tall = constrain(tile({ key: 'display', x: 0, y: 0, width: 20, orientation: 'portrait' }), { columns: 60, rows: 24 });
    const size = footprintOf(tall);
    assert.ok(size.height <= 24 - 3 + 1e-9, `height ${size.height}`);
    assert.equal(tall.y, 1);
    assert.deepEqual(constrain(tile({ key: 'customer', x: 70, y: -4, width: 7 }), DEFAULT_BOUNDS).x, 53);
  });

  it('lerpFootprint tolerates spring overshoot past 1', () => {
    const size = lerpFootprint({ width: 10, height: 5 }, { width: 5, height: 10 }, 1.1);
    assert.ok(Number.isFinite(size.width) && Number.isFinite(size.height));
    assert.ok(size.width < 5 && size.height > 10);
  });
});
