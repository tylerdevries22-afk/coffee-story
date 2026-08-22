import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MENU_IMAGE_SPEC,
  isNoop,
  menuImageCorrection,
  menuImageFrame,
  type MenuImageMeasurement,
} from './menu-image';

/** A measurement sitting comfortably inside every house band. */
const HOUSE: MenuImageMeasurement = { luminance: 48, warmth: 49, saturation: 0.76 };

/**
 * Real measurements. The house rows are the extremes of the 50 in-house shots
 * -- if the grade touches any of these, it is too aggressive. The off-spec rows
 * are the phone snapshots the grade must refuse to fix.
 */
const HOUSE_EXTREMES: [string, MenuImageMeasurement][] = [
  ['cold-brew (darkest)', { luminance: 30.8, warmth: 33.8, saturation: 0.729 }],
  ['honeycomb-cheese-bread (brightest, warmest)', { luminance: 83.9, warmth: 100.3, saturation: 0.75 }],
  ['spanish-oat-shaken (least saturated)', { luminance: 58.2, warmth: 39.2, saturation: 0.463 }],
  ['grilled-cheese (most saturated)', { luminance: 38.7, warmth: 58.1, saturation: 0.885 }],
];

const OFF_SPEC: [string, MenuImageMeasurement][] = [
  ['adeni-chai', { luminance: 158.4, warmth: 33.7, saturation: 0.247 }],
  ['latte', { luminance: 113.8, warmth: 13.7, saturation: 0.291 }],
  ['midnight-lychee', { luminance: 133.7, warmth: -3, saturation: 0.167 }],
  ['turkish-coffee', { luminance: 151, warmth: 31.6, saturation: 0.23 }],
  ['mochi-donut', { luminance: 84.6, warmth: 7.2, saturation: 0.263 }],
];

test('an in-band photo is left completely alone', () => {
  const { correction, beyondGrade } = menuImageCorrection(HOUSE);
  assert.ok(isNoop(correction));
  assert.deepEqual(beyondGrade, []);
});

test('no in-house photo is ever flagged, however extreme', () => {
  for (const [name, measured] of HOUSE_EXTREMES) {
    assert.deepEqual(menuImageCorrection(measured).beyondGrade, [], `${name} was flagged`);
  }
});

test('an off-spec snapshot is refused rather than half-corrected', () => {
  for (const [name, measured] of OFF_SPEC) {
    const { correction, beyondGrade } = menuImageCorrection(measured);
    assert.ok(beyondGrade.length > 0, `${name} should be beyond grade`);
    // The whole point: a refused photo keeps its own pixels.
    assert.ok(isNoop(correction), `${name} must not be partially graded`);
  }
});

test('the axis that put a photo out of reach is named', () => {
  assert.deepEqual(menuImageCorrection({ ...HOUSE, luminance: 158.4 }).beyondGrade, ['luminance']);
  assert.deepEqual(menuImageCorrection({ ...HOUSE, saturation: 0.17 }).beyondGrade, ['saturation']);
  assert.deepEqual(menuImageCorrection({ ...HOUSE, warmth: -3 }).beyondGrade, ['warmth']);
});

test('a photo just outside the band is pulled only as far as the nearest edge', () => {
  const [, ceiling] = MENU_IMAGE_SPEC.grade.luminance.band;
  const measured: MenuImageMeasurement = { ...HOUSE, luminance: 80 };
  const { correction, beyondGrade } = menuImageCorrection(measured);
  assert.deepEqual(beyondGrade, []);
  const landed = measured.luminance * correction.brightness;
  assert.ok(Math.abs(landed - ceiling) < 1e-6, `landed on ${landed}, wanted the ${ceiling} edge`);
});

/** Apply a correction to a measurement the way sharp applies it to pixels. */
const applied = (m: MenuImageMeasurement, c: ReturnType<typeof menuImageCorrection>['correction']): MenuImageMeasurement => ({
  luminance: m.luminance * c.brightness,
  warmth: m.warmth + c.warmth * 2 * 128,
  saturation: Math.min(1, m.saturation * c.saturation),
});

test('grading is idempotent: a corrected photo is in band, so a second pass is a no-op', () => {
  for (const measured of [
    { luminance: 80, warmth: 49, saturation: 0.76 },
    { luminance: 26, warmth: 49, saturation: 0.76 },
    { luminance: 48, warmth: 26, saturation: 0.76 },
    { luminance: 48, warmth: 108, saturation: 0.76 },
    { luminance: 48, warmth: 49, saturation: 0.94 },
    { luminance: 48, warmth: 49, saturation: 0.40 },
  ] satisfies MenuImageMeasurement[]) {
    const first = menuImageCorrection(measured);
    assert.deepEqual(first.beyondGrade, [], `${JSON.stringify(measured)} should be reachable`);
    const second = menuImageCorrection(applied(measured, first.correction));
    assert.ok(isNoop(second.correction), `second pass wanted ${JSON.stringify(second.correction)}`);
  }
});

test('a cool-cast frame is warmed and a warm-cast frame is cooled', () => {
  assert.ok(menuImageCorrection({ ...HOUSE, warmth: 26 }).correction.warmth > 0);
  assert.ok(menuImageCorrection({ ...HOUSE, warmth: 108 }).correction.warmth < 0);
});

test('no applied correction can exceed the safety clamps', () => {
  const { maxCorrection } = MENU_IMAGE_SPEC;
  for (const measured of [
    { luminance: 1, warmth: -400, saturation: 0.001 },
    { luminance: 254, warmth: 400, saturation: 0.999 },
    { luminance: 80, warmth: 26, saturation: 0.40 },
  ] satisfies MenuImageMeasurement[]) {
    const { correction } = menuImageCorrection(measured);
    assert.ok(Math.abs(correction.brightness - 1) <= maxCorrection.brightness + 1e-9);
    assert.ok(Math.abs(correction.saturation - 1) <= maxCorrection.saturation + 1e-9);
    assert.ok(Math.abs(correction.warmth) <= maxCorrection.warmth + 1e-9);
  }
});

test('every variant is square and the fixed sizes match the layouts they replace', () => {
  assert.equal(MENU_IMAGE_SPEC.aspect, 1);
  assert.deepEqual(menuImageFrame('thumb'), { kind: 'fixed', size: 56, radius: 'sm' });
  assert.deepEqual(menuImageFrame('line'), { kind: 'fixed', size: 64, radius: 'sm' });
  assert.deepEqual(menuImageFrame('tile'), { kind: 'fixed', size: 72, radius: 'md' });
  assert.deepEqual(menuImageFrame('row'), { kind: 'fixed', size: 76, radius: 'md' });
  assert.equal(menuImageFrame('hero').kind, 'fill');
});

test('the stored master is big enough for a full-bleed hero', () => {
  // Widest phone the customer app targets is ~430pt. Guard the floor so nobody
  // shrinks the master into visible softness on the hero.
  assert.ok(MENU_IMAGE_SPEC.edge >= 900);
});
