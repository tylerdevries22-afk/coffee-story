import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import baseline from './line-length-baseline.json' with { type: 'json' };

/**
 * The 200-line rule, enforced against new debt only.
 *
 * CLAUDE.md and the global rules both require source files at or below 200
 * lines, and nothing checked it: `eslint.config.js` has no `max-lines`, so the
 * rule lived entirely in review and a hundred files had drifted past it.
 *
 * A blanket ratchet was explicitly rejected for this roadmap -- files are split
 * when a phase touches them, not on a schedule -- so this guard does not
 * demand that any of those hundred be split. It grandfathers every one at the
 * length it had, and fails on two things only: a file that is newly over the
 * limit, and a grandfathered file that grew. Shrinking one past 200 and
 * deleting its entry is always allowed and never required.
 *
 * The ledger is data, not code, so it lives in a JSON file beside this test.
 * It should only ever get shorter.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const LIMIT = baseline.limit;
const GRANDFATHERED = baseline.grandfathered as Readonly<Record<string, number>>;

/** Build output, vendored code and generated files are exempt by policy. */
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.next-preview', 'dist', 'dist-web', 'dist-e2e',
  '.expo', '.git',
]);

/**
 * Tests, fixtures and generated types are exempt.
 *
 * A test that reads a long table of cases is clearer as one file, and
 * `generated.ts` is written by a tool. Migrations are SQL and never counted.
 */
function counted(name: string): boolean {
  if (!/\.(ts|tsx|mjs)$/.test(name)) return false;
  return !name.includes('.test.') && !name.includes('generated') && !name.endsWith('.fixture.ts');
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (counted(entry)) found.push(full);
  }
  return found;
}

/**
 * Lines the way `wc -l` counts them, which is what the baseline was generated
 * with and what anyone checking a claim here will reach for. A file ending in
 * a newline has that trailing empty segment discarded; one that does not still
 * counts its last line.
 */
function lineCount(contents: string): number {
  const parts = contents.split('\n');
  return contents.endsWith('\n') ? parts.length - 1 : parts.length;
}

const measured = new Map<string, number>();
for (const base of ['apps', 'packages', 'scripts', 'tools', 'tests']) {
  for (const file of sourceFiles(join(ROOT, base))) {
    measured.set(
      relative(ROOT, file).split('\\').join('/'),
      lineCount(readFileSync(file, 'utf8')),
    );
  }
}

describe('source files stay at or below 200 lines', () => {
  it('measures the tree, so the guard cannot pass by finding nothing', () => {
    assert.ok(measured.size > 400, `counted only ${measured.size} source files`);
  });

  it('adds no new file over the limit', () => {
    const offenders = [...measured]
      .filter(([, lines]) => lines > LIMIT)
      .filter(([path]) => !(path in GRANDFATHERED))
      .map(([path, lines]) => `${path} (${lines})`)
      .sort();
    assert.deepEqual(offenders, [],
      `these files exceed ${LIMIT} lines. Split them into focused modules -- or, `
      + 'if the length is genuinely justified, add them to '
      + 'line-length-baseline.json with a reason in the pull request.');
  });

  it('lets no grandfathered file grow', () => {
    const grown = Object.entries(GRANDFATHERED)
      .map(([path, was]) => ({ path, was, now: measured.get(path) }))
      .filter((entry) => entry.now !== undefined && entry.now > entry.was)
      .map((entry) => `${entry.path}: ${entry.was} -> ${entry.now}`)
      .sort();
    assert.deepEqual(grown, [],
      'these files were already over the limit and got longer. Adding to a file '
      + 'that is already too long is the one thing this guard exists to stop.');
  });

  it('keeps the ledger honest about what is still on it', () => {
    // An entry for a file that no longer exists, or that has been split below
    // the limit, is stale -- and a stale ledger stops describing the debt.
    const stale = Object.keys(GRANDFATHERED)
      .filter((path) => {
        const now = measured.get(path);
        return now === undefined || now <= LIMIT;
      })
      .sort();
    assert.deepEqual(stale, [],
      'these entries are no longer over the limit or no longer exist. Delete '
      + 'them from line-length-baseline.json -- the ledger should only shrink.');
  });

  it('records the debt it is holding, so the number is visible rather than implied', () => {
    const over = [...measured].filter(([, lines]) => lines > LIMIT).length;
    assert.equal(over, Object.keys(GRANDFATHERED).length,
      'every file over the limit is either grandfathered or a failure above');
    // Not an assertion about the right number, just a place the count is
    // written down. It was 100 when the guard landed, 20 of them over 400.
    assert.ok(over <= 100, `debt grew to ${over} files; the ledger only shrinks`);
  });
});
