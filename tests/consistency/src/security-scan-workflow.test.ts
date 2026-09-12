import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * docs/franchise-readiness/tasks.yaml CI-01 is pending: `audit` in verify.yml
 * only runs `pnpm audit` (known-vulnerable dependencies), so nothing scans
 * source for vulnerability patterns or the tree for committed secrets. This
 * guards that the dedicated workflow exists, triggers on the events that
 * matter, and pins every third-party action to an immutable commit --
 * a floating tag would let a retagged or compromised upstream release run
 * against this repository's secrets without a diff to review.
 */
const ROOT = join(process.cwd(), '..', '..');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'security-scan.yml'), 'utf8');

describe('security-scan workflow exists and is pinned', () => {
  it('runs on pull requests and on push to main', () => {
    assert.match(workflow, /^on:\s*\n\s*pull_request:\s*\n\s*push:\s*\n\s*branches: \[main\]/m);
  });

  it('pins every third-party action to a full commit SHA, never a floating tag', () => {
    const references = [...workflow.matchAll(/^\s*(?:- )?uses:\s+(\S+)/gm)]
      .map((match) => match[1])
      .filter((reference): reference is string => reference !== undefined && !reference.startsWith('./'));
    assert.ok(references.length >= 4, `expected at least gitleaks + codeql init/analyze + checkout, found ${references.length}`);
    for (const reference of references) {
      assert.match(reference, /@[0-9a-f]{40}$/, `${reference} is not pinned to a 40-character commit SHA`);
    }
  });

  it('runs gitleaks for secret scanning and fails closed on a finding', () => {
    assert.match(workflow, /uses: gitleaks\/gitleaks-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    // No continue-on-error anywhere near the gitleaks step: a finding must
    // fail the job, not just get logged.
    const gitleaksJob = workflow.slice(workflow.indexOf('gitleaks:'), workflow.indexOf('codeql:'));
    assert.doesNotMatch(gitleaksJob, /continue-on-error/);
  });

  it('runs CodeQL for javascript-typescript with the standard init/analyze pair', () => {
    assert.match(workflow, /uses: github\/codeql-action\/init@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    assert.match(workflow, /uses: github\/codeql-action\/analyze@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    assert.match(workflow, /languages: javascript-typescript/);
    // Default queries: no `queries:` input pins a non-default suite.
    assert.doesNotMatch(workflow, /queries:/);
  });

  it('keeps permissions minimal', () => {
    // `[ \t]`, not `\s`: `\s` also matches the newline ending each line, which
    // lets the block quantifier hop the blank line after it and swallow the
    // unindented `jobs:` section along with everything under it.
    const permissionsBlock = /^permissions:\n((?:[ \t]+\S.*\n)+)/m.exec(workflow)?.[1] ?? '';
    assert.ok(permissionsBlock, 'a top-level permissions block must exist');
    assert.match(permissionsBlock, /contents: read/);
    assert.match(permissionsBlock, /security-events: write/);
    // Nothing else: exactly two permission keys.
    const grantedKeys = [...permissionsBlock.matchAll(/^\s+([a-z-]+):/gm)].map((match) => match[1]);
    assert.deepEqual(grantedKeys.sort(), ['contents', 'security-events']);
  });

  it('is not wired into required checks here -- that is owner territory', () => {
    const ownerActions = readFileSync(join(ROOT, 'OWNER-ACTIONS.md'), 'utf8');
    assert.match(ownerActions, /security-scan/);
  });
});
