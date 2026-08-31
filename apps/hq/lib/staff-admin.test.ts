import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  emailsForUserIds, findAuthUserByEmail, resolveOrInviteStaffUser,
  staffInvitationRedirectUrl, type StaffAuthAdmin,
} from './staff-admin';

const users = Array.from({ length: 201 }, (_, index) => ({
  id: `user-${index}`,
  email: index === 200 ? 'target@example.com' : `person-${index}@example.com`,
}));

function admin(directory = users) {
  const invites: string[] = [];
  const value: StaffAuthAdmin = {
    listUsers: async ({ page, perPage }) => ({
      data: { users: directory.slice((page - 1) * perPage, page * perPage) }, error: null,
    }),
    inviteUserByEmail: async (email) => {
      invites.push(email);
      return { data: { user: { id: 'invited', email } }, error: null };
    },
  };
  return { admin: value, invites };
}

describe('staff auth administration', () => {
  it('uses the isolated deployment URL for preview invitation callbacks', () => {
    assert.equal(staffInvitationRedirectUrl({
      hqUrl: 'https://coffee-hq.vercel.app',
      vercelEnvironment: 'preview', vercelUrl: 'coffee-hq-feature.vercel.app',
    }), 'https://coffee-hq-feature.vercel.app/auth/callback?next=/staff');
  });

  it('finds an exact normalized email across bounded pages', async () => {
    const setup = admin();
    assert.equal((await findAuthUserByEmail(setup.admin, 'target@example.com'))?.id, 'user-200');
  });

  it('does not invite an existing identity and invites a missing one once', async () => {
    const setup = admin();
    assert.deepEqual(await resolveOrInviteStaffUser(
      setup.admin, 'target@example.com', 'https://hq.example.com/auth/callback',
    ), { userId: 'user-200', invited: false });
    assert.deepEqual(await resolveOrInviteStaffUser(
      setup.admin, 'new@example.com', 'https://hq.example.com/auth/callback',
    ), { userId: 'invited', invited: true });
    assert.deepEqual(setup.invites, ['new@example.com']);
  });

  it('returns only requested directory emails', async () => {
    const setup = admin();
    const result = await emailsForUserIds(setup.admin, new Set(['user-0', 'user-200']));
    assert.deepEqual([...result], [
      ['user-0', 'person-0@example.com'], ['user-200', 'target@example.com'],
    ]);
  });
});
