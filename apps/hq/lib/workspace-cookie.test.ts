import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expiredWorkspaceCookieOptions,
  isWorkspaceCookieValue,
  workspaceCookieOptions,
} from './workspace-cookie';

test('workspace cookies are scoped to the whole console', () => {
  assert.deepEqual(workspaceCookieOptions(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
});

test('workspace cookie expiry preserves the creation path', () => {
  const options = expiredWorkspaceCookieOptions();
  assert.equal(options.path, '/');
  assert.equal(options.maxAge, 0);
  assert.equal(new Date(options.expires ?? 1).getTime(), 0);
});

test('workspace cookie values accept only bounded slug-like identifiers', () => {
  assert.equal(isWorkspaceCookieValue('a2f06ae4-94a5-4af5-a90a-52fe31f5e452'), true);
  assert.equal(isWorkspaceCookieValue('../foreign'), false);
  assert.equal(isWorkspaceCookieValue('x'.repeat(65)), false);
});
