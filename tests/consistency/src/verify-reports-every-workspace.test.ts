/**
 * One workspace's failure must not hide another workspace's.
 *
 * The root `verify` ends in `pnpm -r verify`, and every workspace's own verify
 * is `lint && typecheck && test && build`. Without --no-bail, pnpm stops at the
 * first workspace that fails, so nothing after it in topological order runs at
 * all -- including its build.
 *
 * That is not hypothetical. A single file over the 200-line limit failed
 * tests/consistency, which runs before apps/hq, so `next build` never executed
 * for the entire life of a branch. When the size gate finally went green the
 * build ran for the first time and reported 27 errors that had been there the
 * whole time. The cheap failure hid the expensive one.
 *
 * --no-bail keeps the exit code -- a failing run still fails -- and only
 * changes whether the remaining workspaces get to report. A failing CI run
 * takes longer for it. That is the trade: minutes against a class of defect
 * that stays invisible until something unrelated is fixed.
 *
 * This does not fix the same ordering INSIDE a workspace: apps/hq's own test
 * failure still prevents apps/hq's build. Narrowing that would mean deciding
 * a build is worth attempting after a typecheck failure, which it usually is
 * not. The property worth having is that workspace A cannot mask workspace B.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');

function rootScripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

describe('verify reports every workspace', () => {
  it('has a root verify script that fans out across workspaces', () => {
    const verify = rootScripts().verify;
    assert.ok(verify, 'the root package.json has no verify script');
    assert.match(verify, /pnpm -r\b[^&|]*\bverify/,
      'root verify no longer delegates to the workspaces, so this rule checks nothing');
  });

  it('does not stop at the first failing workspace', () => {
    const verify = rootScripts().verify ?? '';
    const recursive = /pnpm -r\b([^&|]*)\bverify/.exec(verify)?.[1] ?? '';
    assert.match(recursive, /--no-bail/,
      'pnpm -r verify must pass --no-bail. Without it the first failing workspace '
      + 'stops the run, and every workspace after it -- including its build step -- '
      + 'is silently skipped rather than reported.');
  });
});
