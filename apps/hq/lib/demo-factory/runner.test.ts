import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DemoJobDeps } from './job-build';
import { claimedJob, runDemoJobs, sweepExpiredDemos, type DemoRunOptions } from './runner';
import { CAFE, fakeRunnerDb, type RunnerScript } from './runner.test-support';

const SITE = '0f8e3c52-2b1d-4a6e-9c7f-5d4b3a291e10';
const CLAIMED = { id: 'j1', batch_id: 'b1', google_place_id: CAFE.placeId, attempt: 2, created_by: null };

function setup(script: RunnerScript) {
  const { db, calls } = fakeRunnerDb(script);
  let lookups = 0;
  const deps: DemoJobDeps = {
    db,
    details: async () => { lookups += 1; return CAFE; },
    readKit: null,
    linkSecret: 'k'.repeat(48),
    newSiteId: () => SITE,
    // Invented placeholder name, never a real brand -- see originality.test.ts.
    originalityDenylist: ['Rivalbrew'],
  };
  return { deps, calls, lookups: () => lookups };
}

const OPTIONS: DemoRunOptions = { limit: 2, leaseSeconds: 300, jobMs: 5_000, deadline: Number.MAX_SAFE_INTEGER, now: () => 0 };

describe('claimedJob', () => {
  it('reads a claim, and refuses one missing what finishing it needs', () => {
    assert.deepEqual(claimedJob(CLAIMED), { id: 'j1', batchId: 'b1', placeId: CAFE.placeId, attempt: 2, createdBy: null });
    assert.equal(claimedJob({ ...CLAIMED, attempt: '2' }), null);
    assert.equal(claimedJob({ ...CLAIMED, id: undefined }), null);
  });
});

describe('runDemoJobs', () => {
  it('claims within the brakes, builds, and settles the job for the attempt that held it', async () => {
    const { deps, calls } = setup({
      rpc: { claim_platform_demo_jobs: { data: [CLAIMED] }, finish_platform_demo_job: { data: true } },
    });
    const summary = await runDemoJobs(deps, OPTIONS);
    assert.deepEqual(summary, { claimed: 1, built: 1, skipped: 0, failed: 0, retried: 0 });
    const rpcs = calls.filter((call) => call.kind === 'rpc');
    assert.deepEqual(rpcs[0]?.args, [{ p_limit: 2, p_lease_seconds: 300 }]);
    assert.deepEqual(rpcs[1], { kind: 'rpc', target: 'finish_platform_demo_job', args: [{
      p_job_id: 'j1', p_attempt: 2, p_state: 'built', p_outcome: null, p_site_id: SITE,
    }] });
  });

  it('hands a job back unbuilt once the run is out of time', async () => {
    const { deps, calls, lookups } = setup({
      rpc: { claim_platform_demo_jobs: { data: [CLAIMED] }, finish_platform_demo_job: { data: true } },
    });
    const summary = await runDemoJobs(deps, { ...OPTIONS, deadline: 10, now: () => 11 });
    assert.equal(summary.retried, 1);
    assert.equal(lookups(), 0, 'nothing was paid for');
    assert.deepEqual(calls.at(-1)?.args, [{
      p_job_id: 'j1', p_attempt: 2, p_state: 'queued', p_outcome: 'out_of_time', p_site_id: null,
    }]);
  });

  it('claims nothing it cannot read, and surfaces a failed claim', async () => {
    const empty = setup({ rpc: { claim_platform_demo_jobs: { data: [{ id: 'no attempt' }] } } });
    assert.deepEqual(await runDemoJobs(empty.deps, OPTIONS), { claimed: 0, built: 0, skipped: 0, failed: 0, retried: 0 });
    const failing = setup({ rpc: { claim_platform_demo_jobs: { error: { message: 'down' } } } });
    await assert.rejects(runDemoJobs(failing.deps, OPTIONS));
  });
});

describe('sweepExpiredDemos', () => {
  it('expires what is past its window and deletes each one\'s images', async () => {
    const { deps, calls } = setup({
      rpc: { expire_platform_demo_sites: { data: [{ id: 's1' }, { id: 's2' }] } },
      listed: [{ name: 'logo.webp' }],
    });
    assert.equal(await sweepExpiredDemos(deps.db), 2);
    assert.deepEqual(calls.filter((call) => call.kind === 'remove').map((call) => call.args[0]),
      [['s1/logo.webp'], ['s2/logo.webp']]);
    assert.deepEqual(calls[0]?.args, [{ p_limit: 200 }]);
  });

  it('keeps sweeping when one demo\'s images will not delete', async () => {
    const { deps } = setup({
      rpc: { expire_platform_demo_sites: { data: [{ id: 's1' }] } },
      listed: [{ name: 'logo.webp' }],
      removeError: { message: 'storage down' },
    });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await sweepExpiredDemos(deps.db), 1);
    } finally {
      console.error = original;
    }
  });
});
