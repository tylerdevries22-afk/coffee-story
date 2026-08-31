import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { canCreateLocation, locationCreationAllowed } from './location-capacity';

test('multi-location brands may add another store', () => {
  assert.equal(canCreateLocation(true, 4), true);
});

test('a single-location brand may create its first store only', () => {
  assert.equal(canCreateLocation(false, 0), true);
  assert.equal(canCreateLocation(false, 1), false);
});

test('live capacity fails closed when either scoped read fails', async () => {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: { multi_location: true }, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ count: null, error: { message: 'failed' } }),
  };
  const client = { from: () => query } as unknown as SupabaseClient;
  assert.equal(await locationCreationAllowed(client, 'brand'), null);
});
