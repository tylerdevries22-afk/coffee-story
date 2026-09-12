import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * apps/hq had no logger: every catch block that reported a failure fell back
 * to a raw console.error/console.warn, with no severity taxonomy and no
 * request or brand correlation. apps/hq/lib/log.ts fixes that with one
 * shared `log.error/warn/info`, and this guard keeps it fixed -- every
 * non-test source file under apps/hq/lib and apps/hq/app/api must go
 * through it, never call `console.error`/`console.warn` directly.
 *
 * Before log.ts existed this failed with 21 offending lines across 15 files
 * (12 in apps/hq/lib, 3 in apps/hq/app/api): counted with the same
 * `console\.(error|warn)` pattern this test uses, over the same two roots,
 * excluding test files.
 *
 * Test files are exempt: they legitimately spy on `console.error` by
 * reassigning it (see webhook-diagnostics.test.ts), which is not a call to
 * report a failure and not the thing this guard cares about.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN_ROOTS = ['apps/hq/lib', 'apps/hq/app/api'];
const EXEMPT_FILES = new Set(['apps/hq/lib/log.ts']);
const RAW_CONSOLE = /console\.(error|warn)/;

function isScannable(name: string): boolean {
  return /\.(ts|tsx)$/.test(name) && !name.includes('.test.');
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { found.push(...sourceFiles(full)); continue; }
    if (isScannable(entry)) found.push(full);
  }
  return found;
}

function offendingLines(file: string): string[] {
  const relPath = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT_FILES.has(relPath)) return [];
  return readFileSync(file, 'utf8').split('\n')
    .map((line, index) => `${relPath}:${index + 1}: ${line.trim()}`)
    .filter((entry) => RAW_CONSOLE.test(entry));
}

const files = SCAN_ROOTS.flatMap((base) => sourceFiles(join(ROOT, base)));

describe('apps/hq lib and app/api log through log.ts, never raw console', () => {
  it('scans the tree, so the guard cannot pass by finding nothing', () => {
    assert.ok(files.length > 50, `counted only ${files.length} source files under ${SCAN_ROOTS.join(', ')}`);
  });

  it('finds no raw console.error/console.warn outside log.ts', () => {
    const offenders = files.flatMap(offendingLines).sort();
    assert.deepEqual(offenders, []);
  });
});
