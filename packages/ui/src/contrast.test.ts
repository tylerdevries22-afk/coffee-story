import assert from 'node:assert/strict';
import { test } from 'node:test';

import customerBrand from '../../../apps/customer/src/tenant/brand.json';
import kioskBrand from '../../../apps/kiosk/src/tenant/brand.json';
import { AA_NORMAL, contrastRatio, parseHex, relativeLuminance } from './contrast';
import { DEFAULT_TOKENS, resolveTokens } from './tokens';

test('contrast arithmetic matches WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.deepEqual(parseHex('#abc'), parseHex('#aabbcc'));
  assert.throws(() => parseHex('nope'));
});

test('semantic text tokens clear AA on every tenant surface', () => {
  const configs = [DEFAULT_TOKENS, resolveTokens(customerBrand.tokens), resolveTokens(kioskBrand.tokens)];
  for (const tokens of configs) {
    for (const background of [tokens.surface, tokens.surfaceElevated]) {
      for (const foreground of [tokens.textPrimary, tokens.textMuted, tokens.success, tokens.warning, tokens.danger]) {
        const ratio = contrastRatio(foreground, background);
        assert.ok(ratio >= AA_NORMAL, `${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
