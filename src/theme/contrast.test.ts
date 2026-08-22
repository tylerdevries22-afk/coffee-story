import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colors } from './tokens';
import { AA_LARGE, AA_NORMAL, contrastRatio, parseHex, relativeLuminance } from './contrast';

const round = (n: number) => Math.round(n * 100) / 100;

test('the maths matches the WCAG reference values', () => {
  assert.equal(round(contrastRatio('#000000', '#FFFFFF')), 21);
  assert.equal(round(contrastRatio('#FFFFFF', '#FFFFFF')), 1);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.equal(round(relativeLuminance('#FFFFFF')), 1);
  assert.deepEqual(parseHex('#abc'), parseHex('#aabbcc'));
  assert.throws(() => parseHex('nope'));
});

test('contrast is order-independent', () => {
  assert.equal(contrastRatio(colors.ink900, colors.brand100), contrastRatio(colors.brand100, colors.ink900));
});

/**
 * The surfaces text actually lands on. `admin` and `staff` are the pale plum
 * workspace washes from TONE_SURFACES in components/ui.tsx; `deep` is the dark
 * one; the rest are cards.
 */
const SURFACES = {
  admin: colors.brand100,
  staff: colors.brand50,
  card: colors.white,
  surface: colors.surface,
  warm: colors.warm,
  // The order flow paints its page and header with brand200 (pinned by
  // components/collapsing-screen.test.ts). It was the one real text surface
  // this file did not guard, and it is the darkest of them -- ink500 measures
  // 4.41:1 on it, which is why components/ui.tsx's muted copy is ink600.
  order: colors.brand200,
} as const;

test('body and muted copy clear AA on every light surface', () => {
  // The regression this file exists for: ink500 measured 4.36:1 on brand100 --
  // under AA for normal text, on the entire admin Settings screen, while
  // looking perfectly reasonable in the source.
  for (const [name, background] of Object.entries(SURFACES)) {
    for (const [role, color] of [['body', colors.ink700], ['muted', colors.ink600]] as const) {
      const ratio = contrastRatio(color, background);
      assert.ok(
        ratio >= AA_NORMAL,
        `${role} (${color}) on ${name} (${background}) is ${round(ratio)}:1, needs ${AA_NORMAL}`,
      );
    }
  }
});

test('headings clear AA on every light surface', () => {
  for (const [name, background] of Object.entries(SURFACES)) {
    const ratio = contrastRatio(colors.ink900, background);
    assert.ok(ratio >= AA_NORMAL, `ink900 on ${name} is ${round(ratio)}:1`);
  }
});

test('the plum used for links and actions clears AA on the workspace surfaces', () => {
  for (const surface of [SURFACES.admin, SURFACES.staff, SURFACES.card]) {
    const ratio = contrastRatio(colors.brand700, surface);
    assert.ok(ratio >= AA_NORMAL, `brand700 on ${surface} is ${round(ratio)}:1`);
  }
});

test('white text clears AA on the dark chips that carry it', () => {
  // The only places white is still correct: filled pills and badges.
  for (const background of [colors.brand600, colors.brand700, colors.brand800, colors.brand900, colors.ink900]) {
    const ratio = contrastRatio(colors.white, background);
    assert.ok(ratio >= AA_NORMAL, `white on ${background} is ${round(ratio)}:1`);
  }
});

test('white text does NOT clear AA on the pale workspace surfaces', () => {
  // Documents why the migration was needed at all. If a future palette change
  // made this pass, the guard above would have stopped meaning anything.
  for (const surface of [SURFACES.admin, SURFACES.staff]) {
    assert.ok(
      contrastRatio(colors.white, surface) < AA_LARGE,
      `white on ${surface} now passes; the pale-surface assumption has changed`,
    );
  }
});

test('muted stays visibly lighter than body, so the hierarchy is real', () => {
  assert.ok(
    relativeLuminance(colors.ink600) > relativeLuminance(colors.ink700),
    'muted must be lighter than body',
  );
  assert.ok(
    relativeLuminance(colors.ink600) < relativeLuminance(colors.ink500),
    'muted must be darker than the old ink500 it replaced',
  );
});

test('semantic colours clear AA on the surfaces they are used on', () => {
  for (const [name, color] of [['success', colors.success], ['warning', colors.warning], ['danger', colors.danger]] as const) {
    const ratio = contrastRatio(color, colors.white);
    assert.ok(ratio >= AA_NORMAL, `${name} (${color}) on white is ${round(ratio)}:1`);
  }
});
