/**
 * The product lock, asserted where it is enforced.
 *
 * "Go live is never automatic. Factory completion must not mint production
 * hosts or flip Square live." That rule was stated by four guards and held by
 * none of them: every call site passed a literal `true` to the predicate whose
 * only job was to test the approval flag, so each throw was unreachable. The
 * lock held anyway, purely because the one caller of mintProductionHosts sits
 * inside `if (goLiveApproved)` -- move that call and nothing would have caught
 * it, while four guards went on looking like enforcement.
 *
 * These tests fail against that code and pass against the flag being carried
 * to the point of action.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { advanceFactoryRelease, type FactoryReleaseDependencies } from './factory-release';
import { mintProductionHosts } from './factory-pipeline-tasks';
import type { FactoryRunRow } from './factory-runtime';
import { provisionVercel } from './factory-vercel';

const RUN: FactoryRunRow = {
  id: 'run-1', businessName: 'Stillpoint Builders', tenantSlug: 'stillpoint-builders',
  industryKey: 'construction', locationName: 'Denver', supabaseRegion: 'us-west-1',
  surfaces: ['hq', 'customer', 'operator'],
};

describe('production hosts refuse an unapproved mint', () => {
  /**
   * The guard runs before the first await, so an unapproved call cannot reach
   * a provider, a task update, or the network. That ordering is the test: if
   * the refusal moved below the first updateTask, this would hang or fail on a
   * missing credential instead of throwing.
   */
  it('refuses mintProductionHosts without Go live, before touching anything', async () => {
    await assert.rejects(
      () => mintProductionHosts(RUN, false),
      /refused without Go live approval/i,
    );
  });

  it('refuses provisionVercel without Go live', async () => {
    await assert.rejects(
      () => provisionVercel(RUN, 'tenant/repo', { goLiveApproved: false }),
      /without explicit Go live/i,
    );
  });

  /** An omitted flag is not an approval. */
  it('treats a missing approval on provisionVercel as refusal', async () => {
    await assert.rejects(
      () => provisionVercel(RUN, 'tenant/repo', {}),
      /without explicit Go live/i,
    );
    await assert.rejects(
      () => provisionVercel(RUN, 'tenant/repo'),
      /without explicit Go live/i,
    );
  });
});

/**
 * The premise the workflow's early return depends on.
 *
 * runPlatformFactory returns `status: 'live'` as soon as promote-live is
 * complete, without re-testing approval. That is only safe because this is the
 * one place promote-live reaches 'completed', and it refuses to get there
 * without the flag -- so a completed promote-live is itself proof of approval.
 */
describe('promote-live cannot complete without Go live', () => {
  function harness(): {
    dependencies: FactoryReleaseDependencies;
    tasks: string[];
    promotions: number;
  } {
    const tasks: string[] = [];
    let promotions = 0;
    const content = {
      releaseKey: 'stillpoint-2026-09-06.1',
      sourceCommitSha: 'c'.repeat(40),
      artifactDigest: `sha256:${'a'.repeat(64)}`,
      artifactIds: ['application'],
    };
    return {
      tasks,
      get promotions() { return promotions; },
      dependencies: {
        loadContentEvidence: async () => content,
        publishContent: async () => undefined,
        organizationBrandId: async () => 'brand-1',
        promoteTenantPackage: async () => { promotions += 1; },
        loadDeploymentEvidence: async () => ({
          artifactDigest: content.artifactDigest,
          commitSha: 'b'.repeat(40),
          canaryStatus: 'passed' as const,
          canaryReference: 'vercel:canary-1',
          promotionReference: 'vercel:production-1',
        }),
        updateTask: async (task, state, code) => { tasks.push(`${task}:${state}:${code ?? ''}`); },
        updateRun: async () => undefined,
      },
    };
  }

  it('blocks promote-live and mints nothing when the flag is absent', async () => {
    const state = harness();
    const result = await advanceFactoryRelease(
      RUN,
      new Set(['publish-content', 'verify-canary', 'create-vercel-projects']),
      { ...state.dependencies, goLiveApproved: false },
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.code, 'go_live_required');
    assert.equal(state.promotions, 0, 'an unapproved run promoted the tenant package');
    assert.ok(state.tasks.includes('promote-live:blocked:go_live_required'));
    assert.ok(!state.tasks.some((entry) => entry.startsWith('promote-live:completed')),
      'promote-live completed without Go live, which is the premise the workflow early return relies on');
  });

  /** Undefined is the automatic factory path, and reads the same as false. */
  it('treats an omitted flag as unapproved', async () => {
    const state = harness();
    const result = await advanceFactoryRelease(
      RUN,
      new Set(['publish-content', 'verify-canary', 'create-vercel-projects']),
      state.dependencies,
    );
    assert.equal(result.code, 'go_live_required');
    assert.equal(state.promotions, 0);
  });

  it('completes promote-live only once the flag is carried', async () => {
    const state = harness();
    const result = await advanceFactoryRelease(
      RUN,
      new Set(['publish-content', 'verify-canary', 'create-vercel-projects']),
      { ...state.dependencies, goLiveApproved: true },
    );
    assert.equal(result.status, 'live');
    assert.equal(state.promotions, 1);
    assert.ok(state.tasks.includes('promote-live:completed:'));
  });
});
