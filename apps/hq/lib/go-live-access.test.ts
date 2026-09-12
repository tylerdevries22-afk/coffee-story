import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canTapGoLive } from './go-live-access';
import type { SessionInfo } from './demo-data';

function session(role: SessionInfo['role']): SessionInfo {
  return {
    userId: 'user-1', email: 'owner@example.com', role,
    brandId: 'brand-1', brandName: 'Juniper Coffee',
  };
}

describe('canTapGoLive', () => {
  it('allows brand_owner and platform_admin only', () => {
    assert.equal(canTapGoLive(session('brand_owner')), true);
    assert.equal(canTapGoLive(session('platform_admin')), true);
    assert.equal(canTapGoLive(session('location_manager')), false);
    assert.equal(canTapGoLive(session('staff')), false);
    assert.equal(canTapGoLive(null), false);
  });
});
