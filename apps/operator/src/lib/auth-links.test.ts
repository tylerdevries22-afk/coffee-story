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
