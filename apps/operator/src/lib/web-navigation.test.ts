import assert from 'node:assert/strict';
import test from 'node:test';

import { PRODUCTION_PORTAL_URL, resolvePortalUrl } from './portal-url';

test('uses the public Vercel deployment when no environment override is present', () => {
  assert.equal(resolvePortalUrl('/api/mobile/bootstrap', undefined, undefined, false), `${PRODUCTION_PORTAL_URL}/api/mobile/bootstrap`);
});

test('resolves only internal paths against a secure portal origin', () => {
  assert.equal(
    resolvePortalUrl('/admin/ads', 'https://portal.example.com/', 'portal.example.com'),
    'https://portal.example.com/admin/ads',
  );
  assert.throws(() => resolvePortalUrl('//attacker.example', 'https://portal.example.com', 'portal.example.com'));
  assert.throws(() => resolvePortalUrl('/account', 'http://portal.example.com', 'portal.example.com'));
  assert.throws(() => resolvePortalUrl('/account', 'https://attacker.example.com', 'portal.example.com'));
  assert.throws(() => resolvePortalUrl('/account', 'https://portal.example.com'));
});

test('allows localhost for local Expo development', () => {
  assert.equal(resolvePortalUrl('/account', 'http://localhost:3000', undefined, true), 'http://localhost:3000/account');
  assert.throws(() => resolvePortalUrl('/account', 'http://localhost:3000', undefined, false));
});
