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

const ANON_JWT = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJpc3MiOiAic3VwYWJhc2UiLCAicm9sZSI6ICJhbm9uIiwgImlhdCI6IDEsICJleHAiOiAyfQ.signature';
const SERVICE_ROLE_JWT = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJpc3MiOiAic3VwYWJhc2UiLCAicm9sZSI6ICJzZXJ2aWNlX3JvbGUiLCAiaWF0IjogMSwgImV4cCI6IDJ9.signature';

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
  }), [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ]);
});
