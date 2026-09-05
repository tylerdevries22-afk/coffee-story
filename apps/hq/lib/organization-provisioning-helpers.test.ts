import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  organizationFailure, organizationInvitationUrl, reconcileUnknownProvisioningInvitation,
  rollbackInvitation, rollbackInvitationSafely,
} from './organization-provisioning-helpers';

describe('organization provisioning helpers', () => {
  it('accepts secure and local invitation destinations only', () => {
    assert.equal(organizationInvitationUrl({ hqUrl: 'https://hq.example.com' }),
      'https://hq.example.com/auth/callback?next=/');
    assert.equal(organizationInvitationUrl({ hqUrl: 'http://evil.example.com' }), null);
  });

  it('keeps database details out of user-facing failures', () => {
    assert.equal(organizationFailure('duplicate key brands_slug_key'),
      'That organization handle is already in use.');
    assert.equal(organizationFailure('internal relation secret'),
      'The organization could not be provisioned. No partial tenant was activated.');
  });

  it('removes only identities created by the failed provisioning attempt', async () => {
    const removed: string[] = [];
    const admin = { deleteUser: async (id: string) => { removed.push(id); return { error: null }; } };
    await rollbackInvitation(admin, { userId: 'existing', invited: false });
    await rollbackInvitation(admin, { userId: 'new', invited: true });
    assert.deepEqual(removed, ['new']);
  });

  it('retries a transient invitation cleanup failure once', async () => {
    let attempts = 0;
    await rollbackInvitation({ deleteUser: async () => {
      attempts += 1;
      return { error: attempts === 1 ? { message: 'temporary' } : null };
    } }, { userId: 'new', invited: true });
    assert.equal(attempts, 2);
  });

  it('times out and retries a hanging Auth Admin cleanup', async () => {
    let attempts = 0;
    const never = new Promise<{ error: null }>(() => undefined);
    await assert.rejects(rollbackInvitation({ deleteUser: () => {
      attempts += 1;
      return never;
    } }, { userId: 'new', invited: true }, 1), /invitation_rollback_failed/);
    assert.equal(attempts, 2);
  });

  it('bounds cleanup attempts and reports a structured cleanup failure', async () => {
    let attempts = 0;
    const reports: string[] = [];
    const admin = { deleteUser: async () => {
      attempts += 1;
      return { error: { message: 'unavailable' } };
    } };
    await rollbackInvitationSafely(admin, { userId: 'new', invited: true },
      (message) => reports.push(message));
    assert.equal(attempts, 2);
    assert.match(reports[0] ?? '', /owner\.invitation_rollback_failed/);
  });

  it('cleans up an invitation only when readback proves provisioning did not commit', async () => {
    const removed: string[] = [];
    const admin = { deleteUser: async (id: string) => { removed.push(id); return { error: null }; } };
    const owner = { userId: 'new', invited: true };
    await reconcileUnknownProvisioningInvitation(admin, owner,
      Promise.resolve({ data: null, error: null }));
    await reconcileUnknownProvisioningInvitation(admin, owner,
      Promise.resolve({ data: { brand_id: 'brand' }, error: null }));
    assert.deepEqual(removed, ['new']);
  });

  it('preserves an owner and reports when provisioning readback is inconclusive', async () => {
    const removed: string[] = [];
    const reports: string[] = [];
    const admin = { deleteUser: async (id: string) => { removed.push(id); return { error: null }; } };
    await reconcileUnknownProvisioningInvitation(admin, { userId: 'new', invited: true },
      Promise.resolve({ data: null, error: { message: 'unavailable' } }),
      (message) => reports.push(message));
    assert.deepEqual(removed, []);
    assert.match(reports[0] ?? '', /owner\.invitation_commit_unknown/);
  });
});
