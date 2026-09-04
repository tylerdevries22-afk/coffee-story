import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { AA_NORMAL, contrastRatio, parseHex, relativeLuminance } from './contrast';
import { DEFAULT_TOKENS, resolveTokens } from './tokens';

/**
 * Every tenant applied to a guest app, read from the tree rather than imported.
 *
 * The two apps used to bundle one brand file each, so this test could import
 * them by path. They now hold one directory per applied tenant, and every one
 * of them has to clear AA -- a franchisee whose palette fails is a franchisee
 * whose app fails, and finding that out at the second brand rather than the
 * fiftieth is the whole point of checking them all.
 */
function appliedBrandTokens(): { label: string; tokens: unknown }[] {
  const found: { label: string; tokens: unknown }[] = [];
  for (const app of ['customer', 'kiosk']) {
    const slots = join(__dirname, '../../../apps', app, 'src', 'tenants');
    for (const entry of readdirSync(slots, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const brand = JSON.parse(
        readFileSync(join(slots, entry.name, 'brand.json'), 'utf8'),
      ) as { tokens?: Record<string, string> };
      found.push({ label: `${app}/${entry.name}`, tokens: brand.tokens });
    }
  }
  return found;
}

test('contrast arithmetic matches WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.deepEqual(parseHex('#abc'), parseHex('#aabbcc'));
  assert.throws(() => parseHex('nope'));
});

test('semantic text tokens clear AA on every applied tenant surface', () => {
  const applied = appliedBrandTokens();
  assert.ok(applied.length > 0, 'no tenant is applied to either guest app');
  const configs = [
    { label: 'defaults', tokens: DEFAULT_TOKENS },
    ...applied.map((brand) => ({ label: brand.label, tokens: resolveTokens(brand.tokens) })),
  ];
  for (const { label, tokens } of configs) {
    for (const background of [tokens.surface, tokens.surfaceElevated]) {
      for (const foreground of [tokens.textPrimary, tokens.textMuted, tokens.success, tokens.warning, tokens.danger]) {
        const ratio = contrastRatio(foreground, background);
        assert.ok(ratio >= AA_NORMAL, `${label}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
});
