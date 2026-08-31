import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { IONICON } from './icon-map';

/**
 * Every SF Symbol any app names must have an Ionicon beside it.
 *
 * AppIcon falls back to a neutral dot for an unmapped name, which is the right
 * runtime behaviour and the wrong review behaviour: on iOS the symbol renders
 * and nobody notices, and the dot only shows up on Android and web, where it
 * looks like a loading state rather than a missing entry. CLAUDE.md calls this
 * out; this is the check that enforces it.
 *
 * It scans every app rather than the one it lives in. This check used to sit
 * inside apps/operator and cover only apps/operator, next to a second copy of
 * the map that apps/customer maintained separately -- so the operator's map
 * grew fourteen entries the customer's never got, and the customer had no
 * check that would have said so. One map, one check, both apps.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SCANNED = ['apps/customer/src', 'apps/operator/src', 'packages/ui/src'];

// The roots that must yield at least one symbol. packages/ui is swept too --
// a shared component that hard-codes a name is as able to miss the map as an
// app is -- but it takes its names as props today and names none of its own.
const NAMES_SYMBOLS = ['apps/customer/src', 'apps/operator/src'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Elements whose `name` is a route or a document meta, not an icon.
 *
 * `<NativeTabs.Trigger name="home">` and `<meta name="viewport">` both put a
 * lowercase word exactly where an icon name sits. Removing the opening tag
 * before the sweep -- rather than allow-listing `home` and `viewport` -- keeps
 * a future symbol by either name from being waved through. Matched across
 * lines because a `<meta>` with several attributes is wrapped.
 */
const NAMES_SOMETHING_ELSE = /<(?:meta|[A-Za-z][\w.]*\.(?:Screen|Trigger))\b[\s\S]*?>/g;

/**
 * Names that reach a renderer other than AppIcon.
 *
 * The customer's rewards tab draws its own cup rather than an SF Symbol
 * (`icon === 'cup' ? <CupIcon /> : <AppIcon />`), so the map has nothing to say
 * about it. Anything added here needs that kind of reason: the sweep is
 * deliberately shape-blind, because the previous version filtered on name
 * shape and so never looked at `creditcard`, `heart` or any other single word
 * outside a hard-coded list -- `heart` was unmapped the whole time.
 */
const DRAWN_ELSEWHERE = new Set(['cup']);

describe('icon map', () => {
  // name -> the files that name it, so a failure says where to look.
  const referenced = new Map<string, Set<string>>();
  for (const scanned of SCANNED) {
    const dir = join(ROOT, scanned);
    // A workspace can be missing in a partial checkout; the roots that are
    // present still get scanned, and the guard below catches an empty sweep.
    if (!existsSync(dir)) continue;
    for (const file of sourceFiles(dir)) {
      const text = readFileSync(file, 'utf8').replace(NAMES_SOMETHING_ELSE, '');
      for (const match of text.matchAll(/(?:name|icon|symbol|default|selected)[=:]\s*['"]([a-z][a-z0-9.]*)['"]/g)) {
        const name = match[1];
        if (!name || DRAWN_ELSEWHERE.has(name)) continue;
        const seen = referenced.get(name) ?? new Set<string>();
        seen.add(relative(ROOT, file));
        referenced.set(name, seen);
      }
    }
  }

  it('finds the symbols the apps actually name', () => {
    // A guard on the guard: if the scan stops matching, every assertion below
    // passes vacuously and the check quietly stops protecting anything.
    assert.ok(referenced.size > 10, `expected to find symbols, found ${referenced.size}`);
    assert.ok(referenced.has('bell'), 'the notifications bell should be found');
  });

  it('scans every app that draws an icon, not just one', () => {
    // The drift this file exists to prevent started as a check that covered
    // one app. Naming the roots here makes dropping one a failure.
    const scannedFiles = [...referenced.values()].flatMap((files) => [...files]);
    for (const root of NAMES_SYMBOLS) {
      if (!existsSync(join(ROOT, root))) continue;
      assert.ok(
        scannedFiles.some((file) => file.startsWith(root)),
        `${root} named no symbols -- the sweep no longer reaches it`,
      );
    }
  });

  it('maps every symbol it finds', () => {
    const unmapped = [...referenced.entries()]
      .filter(([name]) => !(name in IONICON))
      .map(([name, files]) => `${name} (${[...files].sort().join(', ')})`)
      .sort();
    assert.deepEqual(
      unmapped, [],
      `these render a fallback dot on Android and web: ${unmapped.join('; ')}`,
    );
  });
});
