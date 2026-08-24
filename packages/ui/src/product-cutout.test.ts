import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NO_CUTOUT_CORRECTION,
  PRODUCT_CUTOUT_SPEC,
  isCutoutNoop,
  productCutoutFrame,
  productCutoutSeat,
  productCutoutVerdict,
  type ProductCutoutGeometry,
  type ProductCutoutGrade,
  type ProductCutoutMatte,
  type ProductCutoutMeasurement,
} from './product-cutout';

/**
 * A cut-out that came out of the pipeline exactly as the spec asks.
 *
 * Derived from the spec rather than written down: hard-coding the fractions
 * meant that tightening the seat silently turned this fixture into a failing
 * asset, and the tests then failed for a reason that had nothing to do with
 * what they were checking.
 */
const SEATED: ProductCutoutGeometry = {
  height: PRODUCT_CUTOUT_SPEC.seat.glassHeight,
  baseline: PRODUCT_CUTOUT_SPEC.seat.baseline,
  centerX: PRODUCT_CUTOUT_SPEC.seat.centerX,
  width: PRODUCT_CUTOUT_SPEC.seat.maxWidth / 2,
};
const CLEAN: ProductCutoutMatte = { subjectMass: 0.999, softEdge: 0.61, rimLuminance: 140, innerLuminance: 132 };
const MID: ProductCutoutMeasurement = { luminance: 150, warmth: 6, saturation: 0.34 };

/** Stand-in bands, so the colour path is exercised before the real batch seeds it. */
const GRADE: ProductCutoutGrade = {
  luminance: { band: [120, 180] },
  warmth: { band: [-20, 40] },
  saturation: { band: [0.2, 0.55] },
};

test('a glass is portrait, and the frames derive their width from it', () => {
  // `contentFit="contain"` can only be exact if the frame matches the master.
  assert.equal(PRODUCT_CUTOUT_SPEC.aspect, PRODUCT_CUTOUT_SPEC.width / PRODUCT_CUTOUT_SPEC.height);
  assert.ok(PRODUCT_CUTOUT_SPEC.aspect < 1, 'a cut-out is never square -- that is the photo contract');

  for (const variant of ['feature', 'tile'] as const) {
    const frame = productCutoutFrame(variant);
    const drift = Math.abs(frame.width / frame.height - PRODUCT_CUTOUT_SPEC.aspect);
    assert.ok(drift < 0.01, `${variant} frame ${frame.width}x${frame.height} would letterbox`);
  }
  assert.equal(productCutoutFrame('hero').kind, 'fill');
});

test('the master is big enough for the largest frame at 3x', () => {
  // The feature row draws 108pt wide; a 3x screen wants 324px and gets 720.
  assert.ok(PRODUCT_CUTOUT_SPEC.width >= productCutoutFrame('feature').width * 3);
});

test('two different subjects are seated at the same glass height and baseline', () => {
  // The whole reason seating exists: a wide drink and a narrow one must share a
  // rim line, not a bounding box. Fit the box instead and a shelf of six
  // staggers by however much their aspect ratios differ.
  const narrow = productCutoutSeat({ width: 380, height: 1400 });
  const wide = productCutoutSeat({ width: 900, height: 1100 });

  assert.equal(narrow.targetHeight, wide.targetHeight);
  assert.equal(narrow.top + narrow.targetHeight, wide.top + wide.targetHeight);
  assert.notEqual(narrow.targetWidth, wide.targetWidth);
});

test('a seated subject lands on the fractions the spec names', () => {
  // Within `tolerance`, not exactly: the seat rounds to whole pixels, so
  // 0.78 x 1280 ships as 998px and reads back as 0.77969. That is the same
  // tolerance the pipeline's geometry check applies, which is the point --
  // a seated asset has to pass its own audit.
  const { seat, tolerance, width, height } = PRODUCT_CUTOUT_SPEC;
  const placed = productCutoutSeat({ width: 500, height: 1200 });

  assert.ok(Math.abs(placed.targetHeight / height - seat.glassHeight) <= tolerance.seat);
  assert.ok(Math.abs((placed.top + placed.targetHeight) / height - seat.baseline) <= tolerance.seat);
  assert.ok(Math.abs((placed.left + placed.targetWidth / 2) / width - seat.centerX) <= tolerance.centerX);
});

test('a correctly seated, cleanly matted cut-out is left completely alone', () => {
  const { correction, faults } = productCutoutVerdict(MID, SEATED, CLEAN, GRADE);
  assert.deepEqual(faults, []);
  assert.ok(isCutoutNoop(correction));
});

test('geometry faults refuse the asset rather than correcting it', () => {
  for (const [axis, geometry] of [
    ['height', { ...SEATED, height: 0.7 }],
    ['baseline', { ...SEATED, baseline: 0.88 }],
    ['centerX', { ...SEATED, centerX: 0.56 }],
    ['tooWide', { ...SEATED, width: 0.91 }],
  ] as const) {
    const { correction, faults } = productCutoutVerdict(MID, geometry, CLEAN, GRADE);
    assert.ok(faults.includes(axis), `${axis} was not caught`);
    // Geometry is a property of the render, so there is nothing to grade our
    // way out of: the correction must be a no-op, not a half-measure.
    assert.deepEqual(correction, NO_CUTOUT_CORRECTION);
  }
});

test('the matte failures background removal actually produces are each named', () => {
  const cases = [
    ['speckle', { ...CLEAN, subjectMass: 0.94 }],
    ['hardEdge', { ...CLEAN, softEdge: 0.08 }],
    ['halo', { ...CLEAN, rimLuminance: 205 }],
  ] as const;
  for (const [fault, matte] of cases) {
    const { faults } = productCutoutVerdict(MID, SEATED, matte, GRADE);
    assert.ok(faults.includes(fault), `${fault} was not caught`);
  }
});

test('a pale drink is not a halo', () => {
  // The halo check is one-directional because the failure it models is: a light
  // matte left behind makes the rim brighter than the body. A matcha over a
  // white milk base has a body 30 points brighter than its own glass rim and is
  // perfectly fine -- the symmetric version of this check flagged both pale
  // drinks in the first real batch.
  const pale: ProductCutoutMatte = { ...CLEAN, rimLuminance: 176, innerLuminance: 209 };
  assert.deepEqual(productCutoutVerdict(MID, SEATED, pale, GRADE).faults, []);

  const halo: ProductCutoutMatte = { ...CLEAN, rimLuminance: 230, innerLuminance: 176 };
  assert.deepEqual(productCutoutVerdict(MID, SEATED, halo, GRADE).faults, ['halo']);
});

test('the template\'s own rim-light specular streak is not a halo', () => {
  // "Gentle rim light down the right edge" (the locked template) puts a real
  // specular highlight at literally the same pixels a matte fringe would
  // occupy -- the full height of the glass wall, right at the silhouette
  // edge -- so no spatial measurement can tell them apart, only a bound wide
  // enough to admit the template's own expected result. Measured across the
  // ten-item batch this template actually produced: 3 to 33. This pins the
  // top of that range as legitimate, the way the grade bands pin what the
  // in-house photographs actually measure.
  const templateStreak: ProductCutoutMatte = { ...CLEAN, rimLuminance: 165, innerLuminance: 132 };
  assert.deepEqual(productCutoutVerdict(MID, SEATED, templateStreak, GRADE).faults, []);
});

test('a hard-thresholded mask is caught even though it looks perfect by every other measure', () => {
  // The one check that earns its keep: a jagged alpha edge is invisible at
  // thumbnail size and obvious at 3x, and no colour band can see it.
  const { faults } = productCutoutVerdict(MID, SEATED, { ...CLEAN, softEdge: 0 }, GRADE);
  assert.deepEqual(faults, ['hardEdge']);
});

test('an out-of-band colour is pulled only as far as the nearest edge', () => {
  const dim: ProductCutoutMeasurement = { ...MID, luminance: 110 };
  const { correction, faults } = productCutoutVerdict(dim, SEATED, CLEAN, GRADE);

  assert.deepEqual(faults, []);
  const applied = dim.luminance * correction.brightness;
  assert.ok(Math.abs(applied - GRADE.luminance.band[0]) < 1e-6, 'landed somewhere other than the band floor');
});

test('grading is idempotent, so a corrected cut-out is a no-op on the second pass', () => {
  const dim: ProductCutoutMeasurement = { ...MID, luminance: 110 };
  const first = productCutoutVerdict(dim, SEATED, CLEAN, GRADE);
  const applied: ProductCutoutMeasurement = {
    luminance: dim.luminance * first.correction.brightness,
    warmth: dim.warmth + first.correction.warmth * 2 * 128,
    saturation: Math.min(1, dim.saturation * first.correction.saturation),
  };
  assert.ok(isCutoutNoop(productCutoutVerdict(applied, SEATED, CLEAN, GRADE).correction));
});

test('a colour too far out is refused rather than half-corrected', () => {
  // Same doctrine as the photo contract: pushing a washed-out render 2x on
  // saturation does not make it match the house look, it makes it neon.
  const flat: ProductCutoutMeasurement = { ...MID, saturation: 0.02 };
  const { correction, faults } = productCutoutVerdict(flat, SEATED, CLEAN, GRADE);
  assert.ok(faults.includes('saturation'));
  assert.deepEqual(correction, NO_CUTOUT_CORRECTION);
});

test('with no bands seeded yet, geometry and matte still hold but colour does not judge', () => {
  // The batch that seeds the bands has to be measurable without being judged,
  // which is why `grade` is nullable rather than guessed.
  const wild: ProductCutoutMeasurement = { luminance: 3, warmth: 240, saturation: 0.99 };
  assert.deepEqual(productCutoutVerdict(wild, SEATED, CLEAN, null).faults, []);
  assert.deepEqual(productCutoutVerdict(wild, { ...SEATED, height: 0.5 }, CLEAN, null).faults, ['height']);
});
