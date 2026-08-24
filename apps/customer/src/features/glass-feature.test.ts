import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { PRODUCT_CUTOUT_SPEC } from '@platform/ui/src/product-cutout';

import {
  BLEED,
  GLASS_FEATURE_REST,
  GLASS_BASE_Y,
  GLASS_BOX_HEIGHT,
  GLASS_BOX_WIDTH,
  GLASS_FOOTING,
  GLASS_INSET_X,
  GLASS_OVERHANG,
  GLASS_PARALLAX,
  GLASS_TOP,
  GLASS_VISUAL_HEIGHT,
  GROUND_HEIGHT,
  GROUND_PARALLAX,
  GROUND_TOP,
  SLOT_HEIGHT,
  SLOT_WIDTH,
  VISIBLE_WIDTH,
  glassParallaxRange,
  groundParallaxRange,
  rowScrollWindow,
  shadowOpacityRange,
  shadowScaleRange,
} from './glass-feature';

const home = readFileSync(join(process.cwd(), 'src', 'screens', 'client', 'home-screen.tsx'), 'utf8');

test('the slot quotes the photographic row rather than re-choosing its numbers', () => {
  // If either style changes, the glass section silently stops sharing the
  // section's column and silhouette -- so the quote is checked, not trusted.
  assert.match(home, new RegExp(`featureImage: \\{ width: ${SLOT_WIDTH}, height: ${GROUND_HEIGHT} \\}`));
  assert.match(home, new RegExp(`featureImageLeft: \\{ marginLeft: -${BLEED}`));
});

test('the render box derives from the master, so contain cannot letterbox', () => {
  const drift = Math.abs(GLASS_BOX_WIDTH / GLASS_BOX_HEIGHT - PRODUCT_CUTOUT_SPEC.aspect);
  assert.ok(drift < 0.01, `box ${GLASS_BOX_WIDTH}x${GLASS_BOX_HEIGHT} does not match the master's aspect`);
});

test('the drink is the number chosen; the box around it is derived', () => {
  // The first version of this module sized the box and let the drink fall where
  // it may, which is how a 190pt glass ended up looking like a 150pt one.
  const drawn = GLASS_BOX_HEIGHT * PRODUCT_CUTOUT_SPEC.seat.glassHeight;
  assert.ok(Math.abs(drawn - GLASS_VISUAL_HEIGHT) <= 1, `the drink draws at ${drawn}, not ${GLASS_VISUAL_HEIGHT}`);
});

test('the widest drink in the set still fits the visible slot', () => {
  // Seating scales by height, so width varies per drink. `maxWidth` is the
  // contract's ceiling and the slot has to honour it, not the average.
  const widest = GLASS_BOX_WIDTH * PRODUCT_CUTOUT_SPEC.seat.maxWidth;
  assert.ok(widest <= VISIBLE_WIDTH, `a maximum-width drink is ${widest}pt in a ${VISIBLE_WIDTH}pt slot`);
});

test('the glass is fully on screen even though its ground bleeds', () => {
  // The ground keeps the section's edge-bleed; the drink must not be sliced by
  // the screen edge, because a cut-out cut off reads as a bug rather than as a
  // photograph continuing. Only the box's transparent margin may cross it.
  const drinkLeft = GLASS_INSET_X + (GLASS_BOX_WIDTH * (1 - PRODUCT_CUTOUT_SPEC.seat.maxWidth)) / 2;
  assert.ok(drinkLeft >= BLEED, 'the widest drink would be sliced by the screen edge');
  assert.equal(GLASS_INSET_X + GLASS_BOX_WIDTH, SLOT_WIDTH - GLASS_INSET_X + 2 * BLEED - BLEED);
});

test('the glass stands on the ground rather than floating in it', () => {
  // Its rim clears the capsule top, and its foot lands inside the capsule with
  // ground still showing beneath -- the two facts that make it an object.
  // Within a point, not exactly: every constant here rounds to whole points,
  // which is the unit the layout is actually in.
  const { baseline, glassHeight } = PRODUCT_CUTOUT_SPEC.seat;
  assert.ok(Math.abs(GLASS_TOP + GLASS_BOX_HEIGHT * baseline - GLASS_BASE_Y) <= 1);
  assert.ok(GLASS_FOOTING > 0, 'the foot hangs off the bottom of the ground');
  assert.ok(GLASS_FOOTING < GROUND_HEIGHT / 4, 'the glass sits too high in its own ground');
  const overhang = GROUND_TOP - GLASS_TOP - GLASS_BOX_HEIGHT * (baseline - glassHeight);
  assert.ok(Math.abs(overhang - GLASS_OVERHANG) <= 1, `the rim clears the capsule by ${overhang}, not ${GLASS_OVERHANG}`);
});

test('the glass never leaves the ground it stands on', () => {
  // The two layers drift in opposite directions, so their separation is the sum
  // of both travels. Spend more than the overhang and the glass visibly floats.
  assert.ok(
    GLASS_PARALLAX + GROUND_PARALLAX < GLASS_OVERHANG,
    'glass and ground separate further than the overhang: the glass would float',
  );
});

test('every layer stays inside the slot at every point of the animation', () => {
  // Android clips overflow and `styles.feature` sets none, so this is a real
  // clipping bug rather than a tidiness preference.
  assert.ok(GLASS_TOP - GLASS_PARALLAX >= 0, 'glass leaves the top of the slot');
  assert.ok(GLASS_TOP + GLASS_BOX_HEIGHT + GLASS_PARALLAX <= SLOT_HEIGHT, 'glass leaves the bottom of the slot');
  assert.ok(GROUND_TOP - GROUND_PARALLAX >= 0, 'ground leaves the top of the slot');
  assert.ok(GROUND_TOP + GROUND_HEIGHT + GROUND_PARALLAX <= SLOT_HEIGHT, 'ground leaves the bottom of the slot');
});

test('a row animates across exactly one viewport of scroll', () => {
  const [start, end] = rowScrollWindow(1200, 800);
  assert.equal(end - start, 800);
  assert.equal(end, 1200 + SLOT_HEIGHT / 2);
});

test('reduced motion rests on the frame the row was composed at', () => {
  // The midpoint of every range is the pose when the row is centred. Holding
  // the *start* value instead -- which is what a disabled animation leaves
  // behind -- parks every row in its entering pose.
  const mid = ([a, b]: [number, number]) => (a + b) / 2;
  assert.equal(mid(glassParallaxRange(0, 800).outputRange), GLASS_FEATURE_REST.glassShift);
  assert.equal(mid(groundParallaxRange(0, 800).outputRange), GLASS_FEATURE_REST.groundShift);
  assert.equal(mid(shadowScaleRange(0, 800).outputRange), GLASS_FEATURE_REST.shadowScaleX);
  assert.equal(mid(shadowOpacityRange(0, 800).outputRange), GLASS_FEATURE_REST.shadowOpacity);
});

test('the shadow tightens as the glass settles, which is what says solid object', () => {
  // Widening while fading is the whole cue. Getting the sign wrong on either
  // reads as a light source moving rather than as an object lifting.
  const scale = shadowScaleRange(0, 800).outputRange;
  const opacity = shadowOpacityRange(0, 800).outputRange;
  assert.ok(scale[0] < scale[1], 'the shadow must widen as the glass lifts');
  assert.ok(opacity[0] > opacity[1], 'the shadow must fade as it widens');
});

test('the glass and the ground move in opposite directions', () => {
  const glass = glassParallaxRange(0, 800).outputRange;
  const ground = groundParallaxRange(0, 800).outputRange;
  assert.ok(glass[0] > glass[1], 'the glass drifts against the page');
  assert.ok(ground[0] < ground[1], 'the ground counter-drifts');
  assert.ok(Math.abs(glass[0]) > Math.abs(ground[0]), 'the glass is the faster plane');
});

test('a row further down the page animates over a later window, by exactly its offset', () => {
  const near = rowScrollWindow(400, 800);
  const far = rowScrollWindow(1400, 800);
  assert.equal(far[0] - near[0], 1000);
  assert.equal(far[1] - near[1], 1000);
});
