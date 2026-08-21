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

test('rejects missing Supabase publishable keys', () => {
  assert.equal(isValidSupabasePublishableKey('short'), false);
  assert.equal(isValidSupabasePublishableKey('a'.repeat(20)), true);
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
