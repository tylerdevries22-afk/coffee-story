import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { factoryRunViews, loadFactoryOverview, providerGuideViews } from './factory-data';

describe('factoryRunViews', () => {
  it('summarizes task and credential readiness without leaking secret values', () => {
    const views = factoryRunViews(
      [{ id: 'run-1', business_name: 'Juniper Coffee', tenant_slug: 'juniper-coffee', state: 'running', stage: 'demo', created_at: '2026-08-27T00:00:00Z' }],
      [{ run_id: 'run-1', task_key: 'research-brand', state: 'completed', attempt_count: 1 }],
      [{ run_id: 'run-1', state: 'verified' }, { run_id: 'run-1', state: 'required' }],
    );
    assert.equal(views[0]?.completedTasks, 1);
    assert.equal(views[0]?.verifiedCredentials, 1);
    assert.equal(views[0]?.requiredCredentials, 2);
  });
});

describe('providerGuideViews', () => {
  it('keeps reviewed text steps and drops unrenderable provider payloads', () => {
    const views = providerGuideViews([
      { provider: 'supabase', title: 'Create a project', owner_role: 'platform', official_url: 'https://supabase.com/docs', steps: ['Create token'], last_verified_at: '2026-08-27' },
      { provider: 'unsafe', title: 'Invalid', owner_role: 'platform', official_url: 'https://example.com', steps: { text: 'not an array' }, last_verified_at: '2026-08-27' },
    ]);
    assert.equal(views.length, 1);
    assert.deepEqual(views[0]?.steps, ['Create token']);
  });
});

describe('loadFactoryOverview', () => {
  it('provides a complete prebuilt demo when hosted Supabase is unconfigured', async () => {
    const overview = await loadFactoryOverview(null);
    assert.equal(overview.source, 'demo');
    assert.equal(overview.runs[0]?.state, 'live');
    assert.equal(overview.runs[0]?.completedTasks, overview.runs[0]?.totalTasks);
    assert.ok(overview.guides.length >= 6);
  });
});
