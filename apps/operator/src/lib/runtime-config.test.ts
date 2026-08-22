import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidStripePublishableKey,
  isValidSupabasePublishableKey,
  isValidSupabaseUrl,
  missingLiveConfig,
} from '@/lib/runtime-config';

test('accepts only Stripe publishable keys', () => {
  assert.equal(isValidStripePublishableKey('pk_live_abc123'), true);
  assert.equal(isValidStripePublishableKey('sk_live_secret'), false);
  assert.equal(isValidStripePublishableKey('pk_test_demo'), true);
});

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
  // React Native does not provide `atob`; the decoder is our own. Deleting the
  // global here proves the check still works on a runtime that has none.
  const original = Reflect.get(globalThis, 'atob');
  Reflect.deleteProperty(globalThis, 'atob');
  try {
    assert.equal(isValidSupabasePublishableKey(ANON_JWT), true);
    assert.equal(isValidSupabasePublishableKey(SERVICE_ROLE_JWT), false);
  } finally {
    if (original !== undefined) Reflect.set(globalThis, 'atob', original);
  }
});

test('treats a malformed token as unusable rather than throwing', () => {
  assert.equal(isValidSupabasePublishableKey('not.a.jwt.at.all.really.truly'), false);
  assert.equal(isValidSupabasePublishableKey('aaaa.!!!!!!!!!!!!!!!!!!!!!.bbbb'), false);
  assert.equal(isValidSupabasePublishableKey('.'.repeat(30)), false);
});

test('refuses a secret key rather than inlining it into the public bundle', () => {
  // The old check was `length >= 20`, so both of these passed and
  // lib/supabase.ts shipped full database authority in the JavaScript every
  // guest downloads.
  assert.equal(isValidSupabasePublishableKey(SERVICE_ROLE_JWT), false);
  assert.equal(isValidSupabasePublishableKey('sb_secret_' + 'a'.repeat(24)), false);
  assert.equal(isValidSupabasePublishableKey('a'.repeat(40)), false);
});

test('reports every missing live dependency', () => {
  assert.deepEqual(missingLiveConfig({
    stripePublishableKey: undefined,
    supabaseUrl: 'bad',
    supabasePublishableKey: 'short',
  }), [
    'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ]);
});
