import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isValidSupabasePublishableKey, isValidSupabaseUrl } from './config';

// A structurally valid JWT with role=anon / role=service_role in the payload.
function fakeJwt(role: string): string {
  const payload = Buffer.from(JSON.stringify({ iss: 'supabase', role }), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

describe('isValidSupabaseUrl', () => {
  it('accepts https and local http only', () => {
    assert.equal(isValidSupabaseUrl('https://abc.supabase.co'), true);
    assert.equal(isValidSupabaseUrl('http://localhost:54321'), true);
    assert.equal(isValidSupabaseUrl('http://127.0.0.1:54321'), true);
    assert.equal(isValidSupabaseUrl('http://evil.example.com'), false);
    assert.equal(isValidSupabaseUrl('not a url'), false);
    assert.equal(isValidSupabaseUrl(undefined), false);
  });
});

// Key-shaped strings assembled at runtime so no secret-pattern literal ever
// lands in the repository — GitHub push protection rightly rejects those.
const publishableShaped = ['sb', 'publishable', 'A'.repeat(30)].join('_');
const secretShaped = ['sb', 'secret', 'B'.repeat(30)].join('_');

describe('isValidSupabasePublishableKey', () => {
  it('accepts the modern publishable prefix and the legacy anon JWT', () => {
    assert.equal(isValidSupabasePublishableKey(publishableShaped), true);
    assert.equal(isValidSupabasePublishableKey(fakeJwt('anon')), true);
  });

  it('rejects everything with database authority', () => {
    assert.equal(isValidSupabasePublishableKey(secretShaped), false);
    assert.equal(isValidSupabasePublishableKey(fakeJwt('service_role')), false);
    assert.equal(isValidSupabasePublishableKey('short'), false);
    assert.equal(isValidSupabasePublishableKey(undefined), false);
  });
});
