import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidApiUrl,
  isValidSupabasePublishableKey,
  isValidSupabaseUrl,
  missingLiveConfig,
} from '@/lib/runtime-config';

test('accepts secure Supabase URLs and local development', () => {
  assert.equal(isValidSupabaseUrl('https://example.supabase.co'), true);
  assert.equal(isValidSupabaseUrl('http://localhost:54321'), true);
  assert.equal(isValidSupabaseUrl('http://example.supabase.co'), false);
});

const ANON_JWT = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJpc3MiOiAic3VwYWJhc2UiLCAicm9sZSI6ICJhbm9uIiwgImlhdCI6IDEsICJleHAiOiAyfQ.signature';
const SERVICE_ROLE_JWT = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJpc3MiOiAic3VwYWJhc2UiLCAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLCAiaWF0IjogMSwgImV4cCI6IDJ9.signature';

test('accepts only Supabase keys that are safe to publish', () => {
  assert.equal(isValidSupabasePublishableKey('short'), false);
  assert.equal(isValidSupabasePublishableKey('sb_publishable_' + 'a'.repeat(24)), true);
  assert.equal(isValidSupabasePublishableKey(ANON_JWT), true);
});

test('reads the role claim without depending on a global atob', () => {
  // React Native does not provide `atob`; the decoder (now in
  // @platform/data) is our own. Deleting the global here proves the check
  // still works on a runtime that has none.
  const original = Reflect.get(globalThis, 'atob');
  Reflect.deleteProperty(globalThis, 'atob');
  try {
    assert.equal(isValidSupabasePublishableKey(ANON_JWT), true);
    assert.equal(isValidSupabasePublishableKey(SERVICE_ROLE_JWT), false);
  } finally {
    if (original !== undefined) Reflect.set(globalThis, 'atob', original);
  }
});

test('refuses a secret key rather than inlining it into the public bundle', () => {
  assert.equal(isValidSupabasePublishableKey(SERVICE_ROLE_JWT), false);
  assert.equal(isValidSupabasePublishableKey('sb_secret_' + 'a'.repeat(24)), false);
  assert.equal(isValidSupabasePublishableKey('a'.repeat(40)), false);
});

test('accepts HTTPS API URLs and localhost development only', () => {
  assert.equal(isValidApiUrl('https://hq.example.com'), true);
  assert.equal(isValidApiUrl('http://localhost:3000'), true);
  assert.equal(isValidApiUrl('http://hq.example.com'), false);
  assert.equal(isValidApiUrl('not a url'), false);
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

test('a localhost API needs no host pin; a hosted one does', () => {
  const base = {
    supabaseUrl: 'http://localhost:54321',
    supabasePublishableKey: 'sb_publishable_' + 'a'.repeat(24),
  };
  assert.deepEqual(missingLiveConfig({ ...base, apiUrl: 'http://localhost:3000', allowedApiHost: undefined }), []);
  assert.deepEqual(
    missingLiveConfig({ ...base, apiUrl: 'https://hq.example.com', allowedApiHost: undefined }),
    ['EXPO_PUBLIC_ALLOWED_API_HOST'],
  );
});
