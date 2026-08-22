import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeOAuthState, encodeOAuthState, STATE_TTL_SECONDS } from './square-oauth-state';

const SECRET = 'test-application-secret';
const NOW = 1_700_000_000;
const STATE = {
  locationId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  expiresAt: NOW + STATE_TTL_SECONDS,
};

test('round-trips a state it signed itself', () => {
  const encoded = encodeOAuthState(SECRET, STATE);
  const result = decodeOAuthState(SECRET, encoded, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.state, STATE);
});

test('refuses a state signed with another secret', () => {
  const encoded = encodeOAuthState('someone-elses-secret', STATE);
  const result = decodeOAuthState(SECRET, encoded, NOW);
  assert.deepEqual(result, { ok: false, reason: 'bad_signature' });
});

test('refuses a location swapped after signing', () => {
  const encoded = encodeOAuthState(SECRET, STATE);
  const tampered = encoded.replace(STATE.locationId, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(decodeOAuthState(SECRET, tampered, NOW), { ok: false, reason: 'bad_signature' });
});

test('refuses a user swapped after signing', () => {
  const encoded = encodeOAuthState(SECRET, STATE);
  const tampered = encoded.replace(STATE.userId, '44444444-4444-4444-8444-444444444444');
  assert.deepEqual(decodeOAuthState(SECRET, tampered, NOW), { ok: false, reason: 'bad_signature' });
});

test('refuses an expiry pushed out after signing', () => {
  const encoded = encodeOAuthState(SECRET, STATE);
  const tampered = encoded.replace(String(STATE.expiresAt), String(NOW + 86_400));
  assert.deepEqual(decodeOAuthState(SECRET, tampered, NOW), { ok: false, reason: 'bad_signature' });
});

test('a captured state stops working once it expires', () => {
  const encoded = encodeOAuthState(SECRET, STATE);
  assert.deepEqual(decodeOAuthState(SECRET, encoded, STATE.expiresAt + 1), { ok: false, reason: 'expired' });
  assert.equal(decodeOAuthState(SECRET, encoded, STATE.expiresAt - 1).ok, true);
});

test('refuses the old two-part state shape entirely', () => {
  // What the previous version minted: <locationId>.<mac>, no user, no expiry.
  assert.deepEqual(
    decodeOAuthState(SECRET, `${STATE.locationId}.deadbeef`, NOW),
    { ok: false, reason: 'malformed' },
  );
});

test('refuses malformed input without throwing', () => {
  for (const raw of ['', '.', 'v1...', 'v2.a.b.1.c', `v1.a.b.notanumber.${'0'.repeat(64)}`]) {
    assert.equal(decodeOAuthState(SECRET, raw, NOW).ok, false);
  }
});
