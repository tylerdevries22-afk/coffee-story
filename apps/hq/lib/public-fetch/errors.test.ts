import assert from 'node:assert/strict';
import test from 'node:test';

import { PublicFetchError, isPublicFetchError, type PublicFetchErrorCode } from './errors';

const CODES: readonly PublicFetchErrorCode[] = [
  'invalid_url', 'not_public', 'redirect_limit', 'too_large', 'wrong_type',
  'timeout', 'http_status', 'budget_exhausted', 'network',
];

test('every code has its own fixed sentence, and a cause never leaks into it', () => {
  const messages = new Set<string>();
  for (const code of CODES) {
    const error = new PublicFetchError(code, { cause: new Error('<html>private body</html>') });
    assert.equal(error.name, 'PublicFetchError');
    assert.equal(error.code, code);
    assert.ok(!error.message.includes('private body'), code);
    messages.add(error.message);
  }
  assert.equal(messages.size, CODES.length);
});

test('an error status names its number and nothing else', () => {
  const error = new PublicFetchError('http_status', { status: 503 });
  assert.equal(error.message, 'The site answered with HTTP 503.');
  assert.equal(error.status, 503);
  assert.equal(new PublicFetchError('http_status').message, 'The site answered with an error status.');
});

test('only network failures and brief server trouble are worth a retry', () => {
  assert.equal(new PublicFetchError('network').transient, true);
  for (const status of [429, 502, 503, 504]) {
    assert.equal(new PublicFetchError('http_status', { status }).transient, true, String(status));
  }
  for (const status of [400, 403, 404, 410, 500, 501]) {
    assert.equal(new PublicFetchError('http_status', { status }).transient, false, String(status));
  }
  for (const code of CODES.filter((entry) => entry !== 'network' && entry !== 'http_status')) {
    assert.equal(new PublicFetchError(code).transient, false, code);
  }
});

test('isPublicFetchError tells the typed failure from anything else', () => {
  assert.equal(isPublicFetchError(new PublicFetchError('timeout')), true);
  assert.equal(isPublicFetchError(new Error('timeout')), false);
  assert.equal(isPublicFetchError({ code: 'timeout' }), false);
});
