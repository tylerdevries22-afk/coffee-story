import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FactoryRunRow } from './factory-runtime';
import {
  advanceFactoryRelease,
  type ContentEvidence,
  type DeploymentEvidence,
  type FactoryReleaseDependencies,
} from './factory-release';

const RUN: FactoryRunRow = {
  id: 'run-1', businessName: 'Stillpoint Builders', tenantSlug: 'stillpoint-builders',
  industryKey: 'construction', locationName: 'Denver', supabaseRegion: 'us-west-1',
  surfaces: ['hq', 'customer', 'operator'],
};
const CONTENT: ContentEvidence = {
  releaseKey: 'stillpoint-2026-09-06.1',
  sourceCommitSha: 'c'.repeat(40),
  artifactDigest: `sha256:${'a'.repeat(64)}`,
  artifactIds: ['application', 'catalog', 'training'],
};
const DEPLOYMENT: DeploymentEvidence = {
  artifactDigest: CONTENT.artifactDigest,
  commitSha: 'b'.repeat(40),
  canaryStatus: 'passed',
  canaryReference: 'vercel:canary-1',
  promotionReference: 'vercel:production-1',
};

function harness(input: {
  content?: ContentEvidence | null;
  deployment?: DeploymentEvidence | null;
  brandId?: string | null;
} = {}) {
  const tasks: string[] = [];
  const runs: Record<string, unknown>[] = [];
  const promotions: Array<{ brandId: string; content: ContentEvidence }> = [];
  let publications = 0;
  const dependencies: FactoryReleaseDependencies = {
    loadContentEvidence: async () => input.content === undefined ? CONTENT : input.content,
    publishContent: async () => { publications += 1; },
    organizationBrandId: async () => input.brandId === undefined ? 'brand-1' : input.brandId,
    promoteTenantPackage: async (brandId, content) => {
      promotions.push({ brandId, content });
    },
    loadDeploymentEvidence: async () => input.deployment === undefined ? DEPLOYMENT : input.deployment,
    updateTask: async (task, state, code) => { tasks.push(`${task}:${state}:${code ?? ''}`); },
    updateRun: async (values) => { runs.push(values); },
  };
  return { dependencies, tasks, runs, promotions, publications: () => publications };
}

describe('advanceFactoryRelease', () => {
  it('blocks at content when an immutable tenant package is absent', async () => {
    const state = harness({ content: null });
    const result = await advanceFactoryRelease(
      RUN, new Set(['create-vercel-projects']), state.dependencies,
    );
    assert.deepEqual(result, {
      status: 'blocked', stage: 'content', code: 'content_bootstrap_required',
    });
    assert.deepEqual(state.promotions, []);
    assert.equal(state.publications(), 0);
  });

  it('resumes after infrastructure, publishes content, and waits for canary evidence', async () => {
    const state = harness({ deployment: null });
    const result = await advanceFactoryRelease(
      RUN, new Set(['create-vercel-projects']), state.dependencies,
    );
    assert.equal(result.code, 'canary_evidence_required');
    assert.equal(state.publications(), 1);
    assert.ok(state.tasks.includes('publish-content:completed:'));
    assert.deepEqual(state.promotions, []);
  });

  it('blocks promote-live until explicit Go live even with matching release evidence', async () => {
    const state = harness();
    const result = await advanceFactoryRelease(RUN, new Set(), state.dependencies);
    assert.deepEqual(result, {
      status: 'blocked', stage: 'canary', code: 'go_live_required',
    });
    assert.deepEqual(state.promotions, []);
    assert.ok(state.tasks.includes('create-vercel-projects:blocked:go_live_required'));
    assert.ok(state.tasks.includes('promote-live:blocked:go_live_required'));
  });

  it('blocks promote-live when Go live is approved but hosts are not minted yet', async () => {
    const state = harness();
    state.dependencies.goLiveApproved = true;
    const result = await advanceFactoryRelease(
      RUN, new Set(['publish-content', 'verify-canary']), state.dependencies,
    );
    assert.deepEqual(result, {
      status: 'blocked', stage: 'canary', code: 'go_live_hosts_required',
    });
    assert.deepEqual(state.promotions, []);
  });

  it('promotes the canonical package only after Go live approval', async () => {
    const state = harness();
    state.dependencies.goLiveApproved = true;
    const result = await advanceFactoryRelease(
      RUN, new Set(['create-vercel-projects']), state.dependencies,
    );
    assert.equal(result.status, 'live');
    assert.deepEqual(state.promotions, [{ brandId: 'brand-1', content: CONTENT }]);
  });

  it('fails closed when canary verification reports a failure', async () => {
    const state = harness({ deployment: { ...DEPLOYMENT, canaryStatus: 'failed' } });
    const result = await advanceFactoryRelease(
      RUN, new Set(['publish-content']), state.dependencies,
    );
    assert.deepEqual(result, {
      status: 'failed', stage: 'canary', code: 'canary_verification_failed',
    });
    assert.ok(state.tasks.includes('verify-canary:failed:canary_verification_failed'));
    assert.ok(!state.tasks.some((task) => task.startsWith('promote-live:')));
  });

  it('blocks promotion when the deployment names a different package digest', async () => {
    const state = harness({
      deployment: { ...DEPLOYMENT, artifactDigest: `sha256:${'d'.repeat(64)}` },
    });
    const result = await advanceFactoryRelease(RUN, new Set(), state.dependencies);
    assert.deepEqual(result, {
      status: 'blocked', stage: 'canary', code: 'deployment_evidence_mismatch',
    });
    assert.deepEqual(state.promotions, []);
  });

  it('completes live promotion after Go live, a passed canary, and provider promotion', async () => {
    const state = harness();
    state.dependencies.goLiveApproved = true;
    const result = await advanceFactoryRelease(
      RUN, new Set(['publish-content', 'verify-canary', 'create-vercel-projects']),
      state.dependencies,
    );
    assert.equal(result.status, 'live');
    assert.deepEqual(state.tasks, ['promote-live:running:', 'promote-live:completed:']);
    assert.deepEqual(state.promotions, [{ brandId: 'brand-1', content: CONTENT }]);
    assert.equal(state.runs.at(-1)?.state, 'live');
  });
});
