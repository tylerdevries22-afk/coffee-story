import assert from 'node:assert/strict';
import test from 'node:test';

import { recoveryCodeFromUrl, recoveryRedirectUrl } from './auth-links';

test('accepts only the allowlisted PKCE recovery callback', () => {
  assert.equal(
    recoveryCodeFromUrl('coffeestory://reset-password?code=0123456789abcdef'),
    '0123456789abcdef',
  );
  assert.equal(recoveryCodeFromUrl('coffeestory://gift?code=0123456789abcdef'), null);
  assert.equal(recoveryCodeFromUrl('https://example.com/?code=0123456789abcdef'), null);
});

test('accepts the Expo Go callback shape without broadening to web origins', () => {
  assert.equal(
    recoveryCodeFromUrl('exp://192.168.1.20:8081/--/reset-password?code=0123456789abcdef'),
    '0123456789abcdef',
  );
  assert.equal(
    recoveryCodeFromUrl('exp://192.168.1.20:8081/--/gift?code=0123456789abcdef'),
    null,
  );
});

test('creates only native-build or Expo Go recovery redirects', () => {
  assert.equal(
    recoveryRedirectUrl(() => 'coffeestory://reset-password'),
    'coffeestory://reset-password',
  );
  assert.equal(
    recoveryRedirectUrl(() => 'exp://192.168.1.20:8081/--/reset-password'),
    'exp://192.168.1.20:8081/--/reset-password',
  );
  assert.throws(() => recoveryRedirectUrl(() => 'https://attacker.example/reset-password'));
});

test('rejects legacy token fragments and malformed codes', () => {
  assert.equal(
    recoveryCodeFromUrl('coffeestory://reset-password#access_token=attacker&refresh_token=attacker'),
    null,
  );
  assert.equal(recoveryCodeFromUrl('coffeestory://reset-password?code=short'), null);
  assert.equal(recoveryCodeFromUrl('not a url'), null);
});

const HOST_TEST_CODE = 'a'.repeat(32);

test('takes a recovery code from a dev server on this machine or the local network', () => {
  for (const host of ['localhost:8081', '127.0.0.1:8081', '192.168.1.42:8081',
    '10.0.0.7:8081', '172.20.1.9:8081', 'abc-xyz.exp.direct']) {
    assert.equal(
      recoveryCodeFromUrl(`exp://${host}/--/reset-password?code=${HOST_TEST_CODE}`),
      HOST_TEST_CODE,
      host,
    );
  }
});

test('refuses a recovery code arriving from anywhere else', () => {
  // The hole: scheme and path were checked, the host was not -- so a crafted
  // link could hand the app someone else's recovery code.
  for (const host of ['evil.example.com', 'coffeestory.evil.com', '8.8.8.8',
    '172.32.0.1', '11.0.0.1', 'exp.direct.evil.com']) {
    assert.equal(
      recoveryCodeFromUrl(`exp://${host}/--/reset-password?code=${HOST_TEST_CODE}`),
      null,
      host,
    );
  }
});

test('still takes the store build own scheme, which needs no host rule', () => {
  assert.equal(recoveryCodeFromUrl(`coffeestory://reset-password?code=${HOST_TEST_CODE}`), HOST_TEST_CODE);
});

test('refuses to mint a callback pointing at a host that is not ours', () => {
  assert.throws(() => recoveryRedirectUrl(() => 'exp://evil.example.com/--/reset-password'));
  assert.equal(
    recoveryRedirectUrl(() => 'exp://192.168.1.42:8081/--/reset-password'),
    'exp://192.168.1.42:8081/--/reset-password',
  );
});
