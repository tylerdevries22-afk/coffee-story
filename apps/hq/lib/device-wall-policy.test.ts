import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deviceWallPolicyFor, deviceWallStreamsEnabled } from './device-wall-policy';

describe('tenant device wall declarations', () => {
  it('enables registration for Coffee Story without enabling streaming', () => {
    const policy = deviceWallPolicyFor('coffee-story');
    assert.equal(policy.enabled, true);
    assert.equal(policy.rollout, 'registration_only');
    assert.equal(deviceWallStreamsEnabled(policy), false);
  });

  it('fails closed for the template and unknown tenants', () => {
    assert.equal(deviceWallPolicyFor(null).enabled, false);
    assert.equal(deviceWallPolicyFor('unknown-franchise').rollout, 'disabled');
  });
});
