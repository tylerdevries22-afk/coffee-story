import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { IONICON } from './icon-map';

/**
 * Every SF Symbol the app names must have an Ionicon beside it.
 *
 * AppIcon falls back to a neutral dot for an unmapped name, which is the right
 * runtime behaviour and the wrong review behaviour: on iOS the symbol renders
 * and nobody notices, and the dot only shows up on Android and web, where it
 * looks like a loading state rather than a missing entry. CLAUDE.md calls this
 * out; this is the check that enforces it.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * SF Symbol names look like `bell`, `sun.max`, `rectangle.grid.2x2.fill`.
 * Matching on that shape rather than on every string keeps ordinary props and
 * copy out of the result.
 */
const SYMBOL = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$|^(bell|bag|banknote|flame|plus|checkmark|gear|person|clock|star|trash|xmark|magnifyingglass)$/;

describe('icon map', () => {
  const referenced = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:name|default|selected)[=:]\s*['"]([a-z][a-z0-9.]*)['"]/g)) {
      if (SYMBOL.test(match[1])) referenced.add(match[1]);
    }
  }

  it('finds the symbols the app actually names', () => {
    // A guard on the guard: if the scan stops matching, every assertion below
    // passes vacuously and the check quietly stops protecting anything.
    assert.ok(referenced.size > 10, `expected to find symbols, found ${referenced.size}`);
    assert.ok(referenced.has('bell'), 'the notifications bell should be found');
  });

  it('maps every symbol it finds', () => {
    const unmapped = [...referenced].filter((name) => !(name in IONICON)).sort();
    assert.deepEqual(
      unmapped, [],
      `these render a fallback dot on Android and web: ${unmapped.join(', ')}`,
    );
  });
});
