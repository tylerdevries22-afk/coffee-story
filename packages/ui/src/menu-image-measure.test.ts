import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MENU_MEASURE_SAMPLE, measureMenuPixels, menuImageWarmthMatrix } from './menu-image';

function solid(red: number, green: number, blue: number, pixels = 16): Uint8Array {
  const rgb = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) rgb.set([red, green, blue], i * 3);
  return rgb;
}

test('luminance and warmth come from the channel means', () => {
  const measured = measureMenuPixels({ red: 120, green: 80, blue: 40 }, solid(120, 80, 40));
  assert.equal(measured.luminance, Number((0.2126 * 120 + 0.7152 * 80 + 0.0722 * 40).toFixed(1)));
  assert.equal(measured.warmth, 80);
  assert.equal(measured.saturation, Number(((120 - 40) / 120).toFixed(3)));
});

test('saturation is averaged per pixel, so a vivid mixed frame is not read as grey', () => {
  // Half pure red, half pure cyan: the mean colour is grey, every pixel is vivid.
  const rgb = new Uint8Array([...solid(255, 0, 0, 8), ...solid(0, 255, 255, 8)]);
  const measured = measureMenuPixels({ red: 127.5, green: 127.5, blue: 127.5 }, rgb);
  assert.equal(measured.saturation, 1);
  assert.equal(measured.warmth, 0);
});

test('black pixels and an empty sample measure as unsaturated rather than failing', () => {
  assert.equal(measureMenuPixels({ red: 0, green: 0, blue: 0 }, solid(0, 0, 0)).saturation, 0);
  assert.equal(measureMenuPixels({ red: 10, green: 10, blue: 10 }, new Uint8Array(0)).saturation, 0);
});

test('the warmth matrix moves red and blue in opposite directions and leaves green alone', () => {
  assert.deepEqual(menuImageWarmthMatrix({ warmth: 0.05 }), [[1.05, 0, 0], [0, 1, 0], [0, 0, 0.95]]);
  assert.deepEqual(menuImageWarmthMatrix({ warmth: 0 }), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
});

test('the sample edge is the one the normaliser has always used', () => {
  assert.equal(MENU_MEASURE_SAMPLE, 128);
});
