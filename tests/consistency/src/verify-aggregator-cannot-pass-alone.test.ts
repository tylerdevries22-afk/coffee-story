/**
 * `verify` is no longer a job that runs anything. Since #181 it is an
 * aggregator over five parallel jobs, and it is the only one of the three
 * required contexts (`verify`, `audit`, `security`) that branch protection
 * on `dev` and `main` can see for that work. Two edits would turn it into a
 * gate that passes while the work under it fails, and neither looks wrong in
 * review:
 *
 * 1. Dropping `if: always()`. A job with only `needs:` is SKIPPED when a
 *    dependency fails, and branch protection counts a skipped required check
 *    as a PASS -- so every red run would go green. The job's own comment says
 *    this; nothing enforced it.
 * 2. Adding a sixth verification job and forgetting to list it in `needs:`.
 *    The aggregator would then pass without ever looking at it.
 *
 * The repository has already been bitten by the general form of this. #147
 * fixed one workspace's failure hiding another's, and #172 fixed a required
 * check that had been red on `dev` for a day because a merge was allowed
 * over it. A silent gate is worse than a missing one: it reports the
 * property it is not checking.
 *
 * These assertions read the workflow as text, like
 * android-verification-gate.test.ts, and pin only what makes the aggregator
 * honest -- not how any individual job does its work.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const WORKFLOW = join(ROOT, '.github', 'workflows', 'verify.yml');
const workflow = readFileSync(WORKFLOW, 'utf8');

/** Every top-level job name, in file order. */
function jobNames(): string[] {
  return [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
    // `on:`'s own keys sit at the same indentation as a job.
    .filter((name) => !['push', 'pull_request', 'workflow_call', 'workflow_dispatch'].includes(name));
}

/** One job's block, from its name to the next top-level job. */
function jobBlock(name: string): string {
  const start = workflow.search(new RegExp(`^ {2}${name}:$`, 'm'));
  assert.ok(start >= 0, `verify.yml has no job named ${name} -- update this test to find it`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][a-z0-9-]*:$/m);
  return rest.slice(0, next === -1 ? undefined : next);
}

/** The jobs whose success `verify` is supposed to be reporting. */
const VERIFICATION_JOBS = jobNames().filter(
  (name) => name !== 'verify' && (name.startsWith('verify-') || name === 'bundle-guest-apps'),
);

describe('the verify aggregator cannot report green over a failed job', () => {
  it('found the aggregator and the jobs beneath it, so the assertions below are not vacuous', () => {
    assert.ok(jobNames().includes('verify'), 'verify.yml no longer has a `verify` job');
    assert.ok(VERIFICATION_JOBS.length >= 5,
      `expected the split verification jobs, found ${VERIFICATION_JOBS.join(', ') || 'none'}`);
  });

  it('runs even when a job beneath it fails, instead of being skipped into a pass', () => {
    assert.match(jobBlock('verify'), /^ {4}if: always\(\)$/m,
      'the `verify` aggregator lost `if: always()`: a skipped required check counts as a pass, '
      + 'so every failing run would report green');
  });

  it('waits on every verification job, so a new one cannot be added outside the gate', () => {
    const needs = jobBlock('verify');
    for (const job of VERIFICATION_JOBS) {
      assert.match(needs, new RegExp(`^ {6}- ${job}$`, 'm'),
        `the \`verify\` aggregator does not list ${job} in needs:, so that job can fail while verify passes`);
    }
  });

  it('fails on any result that is not success, not merely on a failure', () => {
    const block = jobBlock('verify');
    assert.match(block, /needs\.[a-z-]+\.result|toJSON\(needs\)/,
      'the aggregator never reads its dependencies\' results');
    assert.match(block, /result != "success"|result != 'success'|!= *"success"/,
      'the aggregator must reject every non-success result -- `skipped` and `cancelled` included, '
      + 'which a check for `failure` alone would let through');
    assert.match(block, /exit 1/, 'the aggregator never fails the job when a dependency did not succeed');
  });
});
