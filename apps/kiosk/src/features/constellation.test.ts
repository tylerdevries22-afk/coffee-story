import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { KioskNodeEmphasis } from '@platform/domain';

import { CIRCLE_SIZE, layoutConstellation, overlaps, type ConstellationItem } from './constellation';

/** An iPad Pro 11" in landscape, which is what a kiosk stand holds. */
const CANVAS = { width: 1366, height: 1024 };

function items(...emphases: KioskNodeEmphasis[]): ConstellationItem[] {
  return emphases.map((emphasis, index) => ({ id: `n${index}`, emphasis }));
}

const SHAPES: ConstellationItem[][] = [
  items('hero'),
  items('hero', 'standard'),
  items('hero', 'standard', 'standard', 'minor'),
  items('hero', 'standard', 'standard', 'standard', 'minor', 'minor', 'minor'),
  items(...Array.from({ length: 12 }, (_, i) => (i === 0 ? 'hero' : i < 6 ? 'standard' : 'minor') as KioskNodeEmphasis)),
];

describe('layoutConstellation', () => {
  it('places nothing for an empty screen rather than throwing', () => {
    assert.deepEqual(layoutConstellation([], CANVAS), []);
  });

  it('places every tile exactly once, in the tenant order', () => {
    for (const shape of SHAPES) {
      const placed = layoutConstellation(shape, CANVAS);
      assert.equal(placed.length, shape.length);
      assert.deepEqual(placed.map((circle) => circle.id), shape.map((item) => item.id));
      assert.deepEqual(placed.map((circle) => circle.index), shape.map((_, index) => index));
    }
  });

  /**
   * The property that makes a computed layout safe to change. Hand-tuned
   * coordinates would need this checked by eye on every menu edit.
   */
  it('never lets two circles touch, at any tile count', () => {
    for (const shape of SHAPES) {
      const placed = layoutConstellation(shape, CANVAS);
      for (let i = 0; i < placed.length; i += 1) {
        for (let j = i + 1; j < placed.length; j += 1) {
          const a = placed[i];
          const b = placed[j];
          assert.ok(a && b);
          assert.equal(overlaps(a, b), false, `${a.id} overlaps ${b.id} in a ${shape.length}-tile screen`);
        }
      }
    }
  });

  it('keeps every circle on the screen', () => {
    for (const shape of SHAPES) {
      for (const circle of layoutConstellation(shape, CANVAS)) {
        const radius = circle.size / 2;
        assert.ok(circle.x - radius >= -1, `${circle.id} off the left edge`);
        assert.ok(circle.x + radius <= CANVAS.width + 1, `${circle.id} off the right edge`);
        assert.ok(circle.y - radius >= -1, `${circle.id} off the top`);
      }
    }
  });

  it('fits the full seven-tile layout in a 1280x720 kiosk stage', () => {
    const compact = { width: 1216, height: 530 };
    const placed = layoutConstellation(SHAPES[3] ?? [], compact);
    assert.equal(placed.length, 7);
    for (const circle of placed) {
      const radius = circle.size / 2;
      assert.ok(circle.x - radius >= 0, `${circle.id} off the left edge`);
      assert.ok(circle.x + radius <= compact.width, `${circle.id} off the right edge`);
      assert.ok(circle.y - radius >= 0, `${circle.id} off the top`);
      assert.ok(circle.y + radius <= compact.height, `${circle.id} off the bottom`);
    }
  });

  it('expresses emphasis as size, so the hierarchy survives the layout', () => {
    assert.ok(CIRCLE_SIZE.hero > CIRCLE_SIZE.standard);
    assert.ok(CIRCLE_SIZE.standard > CIRCLE_SIZE.minor);
    const placed = layoutConstellation(items('minor', 'hero'), CANVAS);
    assert.equal(placed[0]?.size, CIRCLE_SIZE.minor);
    assert.equal(placed[1]?.size, CIRCLE_SIZE.hero);
  });

  it('is deterministic, because a layout that moves each render fights the entrance', () => {
    const once = layoutConstellation(SHAPES[3] ?? [], CANVAS);
    const twice = layoutConstellation(SHAPES[3] ?? [], CANVAS);
    assert.deepEqual(once, twice);
  });

  it('centres a single tile rather than stranding it in a corner', () => {
    const [only] = layoutConstellation(items('hero'), CANVAS);
    assert.ok(only);
    assert.equal(Math.round(only.x), Math.round(CANVAS.width / 2));
  });
});
