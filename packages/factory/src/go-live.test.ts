import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOADER_STEPS,
  factoryCompletionMintsHosts,
  loaderProgressFromFactoryRun,
  mayMintProductionHosts,
  mayPromoteLive,
  previewSupabaseProjectRef,
  squareEnvForPhase,
} from './go-live';

describe('go-live gates', () => {
  it('never mints production hosts without explicit approval', () => {
    assert.equal(mayMintProductionHosts(false), false);
    assert.equal(mayMintProductionHosts(true), true);
    assert.equal(factoryCompletionMintsHosts(true, false), false);
    assert.equal(factoryCompletionMintsHosts(true, true), true);
    assert.equal(factoryCompletionMintsHosts(false, true), false);
  });

  it('never auto-promotes live or flips Square without approval', () => {
    assert.equal(mayPromoteLive(false), false);
    assert.equal(mayPromoteLive(true), true);
    assert.equal(squareEnvForPhase(false), 'sandbox');
    assert.equal(squareEnvForPhase(true), 'production');
  });

  it('prefers SUPABASE_PREVIEW_PROJECT_REF before go-live', () => {
    assert.equal(previewSupabaseProjectRef({}), null);
    assert.equal(
      previewSupabaseProjectRef({ SUPABASE_PREVIEW_PROJECT_REF: ' abcd1234 ' }),
      'abcd1234',
    );
  });
});

describe('four-step loader', () => {
  it('uses the exact human order Business saved → Database → Apps → Ready', () => {
    assert.deepEqual([...LOADER_STEPS], [
      'Business saved', 'Database', 'Apps', 'Ready',
    ]);
  });

  it('names the shop and never falls back to Coffee Story', () => {
    const early = loaderProgressFromFactoryRun({
      state: 'running', stage: 'intake', businessName: 'Juniper Coffee',
    });
    assert.equal(early.shopName, 'Juniper Coffee');
    assert.equal(early.activeIndex, 0);
    assert.equal(JSON.stringify(early).includes('Coffee Story'), false);

    const missing = loaderProgressFromFactoryRun({
      state: 'running', stage: 'intake',
    });
    assert.equal(missing.shopName, 'Your shop');
    assert.equal(JSON.stringify(missing).includes('Coffee Story'), false);
  });

  it('advances Business saved → Database → Apps → Ready from factory state', () => {
    assert.equal(loaderProgressFromFactoryRun({
      state: 'running', stage: 'intake', businessName: 'Oak Roast',
    }).activeIndex, 0);

    assert.equal(loaderProgressFromFactoryRun({
      state: 'running', stage: 'infrastructure', businessName: 'Oak Roast',
      completedTaskKeys: ['verify-demo', 'collect-credentials'],
    }).activeIndex, 1);

    assert.equal(loaderProgressFromFactoryRun({
      state: 'blocked', stage: 'canary', businessName: 'Oak Roast',
      completedTaskKeys: [
        'create-supabase-project', 'publish-content', 'verify-canary',
      ],
      blockedErrorCode: 'go_live_required',
    }).activeIndex, 2);

    const ready = loaderProgressFromFactoryRun({
      state: 'live', stage: 'live', businessName: 'Oak Roast',
      completedTaskKeys: ['promote-live'],
    });
    assert.equal(ready.activeIndex, 3);
    assert.equal(ready.awaitingGoLive, false);
  });

  it('marks awaiting Go live when canary finished without promote', () => {
    const progress = loaderProgressFromFactoryRun({
      state: 'blocked', stage: 'canary', businessName: 'Pine Bar',
      completedTaskKeys: ['verify-canary'],
      blockedErrorCode: 'go_live_required',
    });
    assert.equal(progress.awaitingGoLive, true);
    assert.equal(progress.activeIndex, 2);
  });
});
