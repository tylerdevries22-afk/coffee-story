import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidSupabasePublishableKey,
  isValidSupabaseUrl,
  missingLiveConfig,
} from '@/lib/runtime-config';

test('accepts secure Supabase URLs and local development', () => {
  assert.equal(isValidSupabaseUrl('https://example.supabase.co'), true);
  assert.equal(isValidSupabaseUrl('http://localhost:54321'), true);
  assert.equal(isValidSupabaseUrl('http://example.supabase.co'), false);
});

function testJwtForRole(role: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [encode({ alg: 'HS256', typ: 'JWT' }), encode({ iss: 'supabase', role }), 'test'].join('.');
}

const ANON_JWT = testJwtForRole('anon');
const SERVICE_ROLE_JWT = testJwtForRole('service_role');

test('accepts only Supabase keys that are safe to publish', () => {
  assert.equal(isValidSupabasePublishableKey('short'), false);
  assert.equal(isValidSupabasePublishableKey('sb_publishable_' + 'a'.repeat(24)), true);
  assert.equal(isValidSupabasePublishableKey(ANON_JWT), true);
});

test('refuses a secret key rather than inlining it into the public bundle', () => {
  assert.equal(isValidSupabasePublishableKey(SERVICE_ROLE_JWT), false);
  assert.equal(isValidSupabasePublishableKey('sb_secret_' + 'a'.repeat(24)), false);
  assert.equal(isValidSupabasePublishableKey('a'.repeat(40)), false);
});

test('reports every missing live dependency', () => {
  assert.deepEqual(missingLiveConfig({
    supabaseUrl: 'bad',
    supabasePublishableKey: 'short',
    apiUrl: undefined,
    allowedApiHost: undefined,
  }), [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_ALLOWED_API_HOST',
  ]);
});

test('requires the platform API for refunds and training submissions', () => {
  assert.deepEqual(missingLiveConfig({
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: ANON_JWT,
    apiUrl: undefined,
    allowedApiHost: undefined,
  }), ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_ALLOWED_API_HOST']);
});

test('accepts a pinned production API and an unpinned localhost API', () => {
  const shared = {
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: ANON_JWT,
  };
  assert.deepEqual(missingLiveConfig({
    ...shared,
    apiUrl: 'https://hq.example.com',
    allowedApiHost: 'hq.example.com',
  }), []);
  assert.deepEqual(missingLiveConfig({
    ...shared,
    apiUrl: 'http://localhost:3000',
    allowedApiHost: undefined,
  }), []);
});
