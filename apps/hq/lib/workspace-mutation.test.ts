import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SessionInfo } from './demo-data';
import { claimsForWorkspaceMutation } from './workspace-mutation-claims';
import { requiresWorkspaceServiceRole } from './workspace-service-role';

const session: SessionInfo = {
  brandId: '11111111-1111-4111-8111-111111111111',
  brandName: 'Home',
  email: 'admin@example.test',
  role: 'platform_admin',
  userId: '22222222-2222-4222-8222-222222222222',
};

describe('claimsForWorkspaceMutation', () => {
  it('routes platform administrators through the audited writer even at home', () => {
    assert.equal(requiresWorkspaceServiceRole(session, session.brandId), true);
    assert.equal(requiresWorkspaceServiceRole({ ...session, role: 'brand_owner' }, session.brandId), false);
  });

  it('scopes a trusted writer to the authorized tenant and location', () => {
    const claims = claimsForWorkspaceMutation(session, {
      auditCorrelationId: '55555555-5555-4555-8555-555555555555',
      brandId: '33333333-3333-4333-8333-333333333333',
      locationId: '44444444-4444-4444-8444-444444444444',
      serviceRole: true,
    });
    assert.equal(claims?.brand_id, '33333333-3333-4333-8333-333333333333');
    assert.deepEqual(claims?.location_ids, ['44444444-4444-4444-8444-444444444444']);
    assert.equal(claims?.role, 'platform_admin');
  });

  it('never invents an actor for an unconfigured demo session', () => {
    assert.equal(claimsForWorkspaceMutation({ ...session, userId: null }, {
      auditCorrelationId: null,
      brandId: session.brandId,
      locationId: null,
      serviceRole: false,
    }), null);
  });
});
