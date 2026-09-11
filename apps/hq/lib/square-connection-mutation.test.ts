import assert from 'node:assert/strict';
import test from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { failSquareConnectionMutation } from './square-connection-mutation';

test('mutation failure retries the same fenced response after delivery loss', async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (calls.length === 1) throw new TypeError('response lost');
    return { data: true, error: null };
  } } as unknown as SupabaseClient;
  const result = await failSquareConnectionMutation(db, {
    brandId: 'brand', locationId: 'location', generation: 'generation', code: 'pre_provider_failure',
  });
  assert.equal(result, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});
