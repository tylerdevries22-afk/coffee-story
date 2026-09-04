import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { AA_NORMAL, contrastRatio, parseHex, relativeLuminance } from './contrast';
import { DEFAULT_TOKENS, resolveTokens } from './tokens';

function brandTokens(label: string, brandPath: string): { label: string; tokens: unknown } {
  const brand = JSON.parse(readFileSync(brandPath, 'utf8')) as { tokens?: Record<string, string> };
  return { label, tokens: brand.tokens };
}

/**
 * Every tenant palette this repository can theme a surface with.
 *
 * Two sources, because a tenant does not have to reach a guest binary to reach
 * a screen. `apps/<app>/src/tenants/<slug>/` is what the customer and kiosk
 * builds bundle -- one directory per applied tenant since the slot stopped
 * being a single shared file. `tenants/<slug>/` is every tenant the platform
 * has onboarded, and HQ themes its whole console from those directly through
 * the organization switcher: `stillpoint-builders` is a construction franchise
 * that is deliberately never applied to a guest app, so nothing checked its
 * palette at all, and it colours every page an operator sees.
 *
 * `_template` is included on purpose. It is the shape every tenant is copied
 * from, so a franchisee who edits nothing inherits whatever it ships.
 *
 * All of them have to clear AA. Finding that out at the second brand rather
 * than the fiftieth is the whole point of checking every one.
 */
function everyBrandTokens(): { label: string; tokens: unknown }[] {
  const found: { label: string; tokens: unknown }[] = [];
  for (const app of ['customer', 'kiosk']) {
    const slots = join(__dirname, '../../../apps', app, 'src', 'tenants');
    for (const entry of readdirSync(slots, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      found.push(brandTokens(`applied ${app}/${entry.name}`, join(slots, entry.name, 'brand.json')));
    }
  }
  const tenants = join(__dirname, '../../../tenants');
  for (const entry of readdirSync(tenants, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const brandPath = join(tenants, entry.name, 'brand.json');
    if (!existsSync(brandPath)) continue;
    found.push(brandTokens(`tenants/${entry.name}`, brandPath));
  }
  return found;
}

test('contrast arithmetic matches WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.deepEqual(parseHex('#abc'), parseHex('#aabbcc'));
  assert.throws(() => parseHex('nope'));
});

test('semantic text tokens clear AA on every tenant surface', () => {
  const applied = everyBrandTokens();
  assert.ok(applied.length > 0, 'found no tenant palettes at all');
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
