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
  const readiness: { brandId: string; check: string; evidence: Record<string, string> }[] = [];
  let publications = 0;
  const dependencies: FactoryReleaseDependencies = {
    loadContentEvidence: async () => input.content === undefined ? CONTENT : input.content,
    publishContent: async () => { publications += 1; },
    organizationBrandId: async () => input.brandId === undefined ? 'brand-1' : input.brandId,
    recordReadiness: async (brandId, check, evidence) => {
      readiness.push({ brandId, check, evidence });
    },
    loadDeploymentEvidence: async () => input.deployment === undefined ? DEPLOYMENT : input.deployment,
    updateTask: async (task, state, code) => { tasks.push(`${task}:${state}:${code ?? ''}`); },
    updateRun: async (values) => { runs.push(values); },
  };
  return { dependencies, tasks, runs, readiness, publications: () => publications };
}

describe('advanceFactoryRelease', () => {
  it('blocks at content without recording readiness when immutable artifacts are absent', async () => {
    const state = harness({ content: null });
    const result = await advanceFactoryRelease(
      RUN, new Set(['create-vercel-projects']), state.dependencies,
    );
    assert.deepEqual(result, {
      status: 'blocked', stage: 'content', code: 'content_bootstrap_required',
    });
    assert.deepEqual(state.readiness, []);
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
    assert.deepEqual(state.readiness.map(({ check }) => check), ['tenant_artifacts']);
  });

  it('records both readiness checks with immutable evidence only', async () => {
    const state = harness();
    const result = await advanceFactoryRelease(RUN, new Set(), state.dependencies);
    assert.equal(result.status, 'live');
    assert.deepEqual(state.readiness, [
      { brandId: 'brand-1', check: 'tenant_artifacts', evidence: {
        artifactDigest: CONTENT.artifactDigest,
      } },
      { brandId: 'brand-1', check: 'release_approval', evidence: {
        commitSha: DEPLOYMENT.commitSha,
        artifactDigest: CONTENT.artifactDigest,
        providerReference: 'vercel:production-1',
      } },
    ]);
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

  it('completes live promotion after a passed canary and provider promotion', async () => {
    const state = harness();
    const result = await advanceFactoryRelease(
      RUN, new Set(['publish-content', 'verify-canary']), state.dependencies,
    );
    assert.equal(result.status, 'live');
    assert.deepEqual(state.tasks, ['promote-live:running:', 'promote-live:completed:']);
    assert.deepEqual(state.readiness.map(({ check }) => check), [
      'tenant_artifacts', 'release_approval',
    ]);
    assert.equal(state.runs.at(-1)?.state, 'live');
  });
});
