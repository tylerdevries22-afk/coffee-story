import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hostedSeedTargetIssue } from './onboard-database';

describe('hostedSeedTargetIssue', () => {
  it('requires an existing brand and provisioning ledger', () => {
    assert.match(hostedSeedTargetIssue(null, null) ?? '', /provisioned through the HQ workflow/);
    assert.match(
      hostedSeedTargetIssue({ id: 'brand-1', status: 'provisioning' }, null) ?? '',
      /provisioning ledger/,
    );
  });

  it('allows only coherent provisioning and active lifecycle pairs', () => {
    assert.equal(hostedSeedTargetIssue(
      { id: 'brand-1', status: 'provisioning' }, { stage: 'awaiting_external' },
    ), null);
    assert.equal(hostedSeedTargetIssue(
      { id: 'brand-1', status: 'provisioning' }, { stage: 'ready' },
    ), null);
    assert.equal(hostedSeedTargetIssue(
      { id: 'brand-1', status: 'active' }, { stage: 'active' },
    ), null);
  });

  it('rejects lifecycle combinations that bypass readiness activation', () => {
    assert.match(hostedSeedTargetIssue(
      { id: 'brand-1', status: 'active' }, { stage: 'awaiting_external' },
    ) ?? '', /inconsistent organization lifecycle/);
    assert.match(hostedSeedTargetIssue(
      { id: 'brand-1', status: 'provisioning' }, { stage: 'active' },
    ) ?? '', /inconsistent organization lifecycle/);
  });
});
