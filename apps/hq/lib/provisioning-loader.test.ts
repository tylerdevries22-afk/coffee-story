import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LOADER_STEPS,
  loaderProgressFromFactoryRun,
} from '@platform/factory';

describe('new-shop provisioning loader copy', () => {
  it('keeps the exact four human steps and never embeds Coffee Story', () => {
    assert.deepEqual([...LOADER_STEPS], [
      'Business saved', 'Database', 'Apps', 'Ready',
    ]);
    const progress = loaderProgressFromFactoryRun({
      state: 'blocked',
      stage: 'canary',
      businessName: 'Juniper Coffee',
      completedTaskKeys: ['create-supabase-project', 'verify-canary'],
      blockedErrorCode: 'go_live_required',
    });
    const serialized = JSON.stringify(progress);
    assert.equal(serialized.includes('Coffee Story'), false);
    assert.equal(serialized.includes('coffee-story'), false);
    assert.equal(progress.shopName, 'Juniper Coffee');
    assert.deepEqual([...progress.steps], [...LOADER_STEPS]);
  });
});
