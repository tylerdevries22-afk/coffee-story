import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MENU_CROP_CENTER, menuImageCropWindow } from './menu-image';

test('a portrait source is cut to its full width, a little below centre', () => {
  // The in-house 600x682 masters: the square keeps all 600 columns and sits
  // lower than a centred cut would, keeping the saucer rather than the ceiling.
  assert.deepEqual(menuImageCropWindow(600, 682), { left: 0, top: 75, side: 600 });
  const centred = (682 - 600) / 2;
  assert.ok(menuImageCropWindow(600, 682).top > centred);
});

test('a landscape source is cut to its full height, centred across', () => {
  assert.deepEqual(menuImageCropWindow(1200, 800), { left: 200, top: 0, side: 800 });
});

test('a square source is left whole, and the window never leaves the frame', () => {
  assert.deepEqual(menuImageCropWindow(900, 900), { left: 0, top: 0, side: 900 });
  for (const [width, height] of [[10, 1000], [1000, 10], [301, 299], [1, 1]] as const) {
    const { left, top, side } = menuImageCropWindow(width, height);
    assert.ok(left >= 0 && top >= 0, `${width}x${height}`);
    assert.ok(left + side <= width && top + side <= height, `${width}x${height}`);
  }
});

test('the crop centre is the one the normaliser has always used', () => {
  assert.equal(MENU_CROP_CENTER, 0.55);
});
