import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ensurePlatformBrandMembership } from './platform-membership';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

it('uses only the guarded membership RPC and validates its identifier', async () => {
  const calls: unknown[] = [];
  const db = {
    rpc: async (name: string, input: unknown) => {
      calls.push({ name, input });
      return { data: MEMBER, error: null };
    },
  } as unknown as SupabaseClient;
  assert.equal(await ensurePlatformBrandMembership(db, ACTOR, BRAND), MEMBER);
  assert.deepEqual(calls, [{
    name: 'ensure_platform_brand_membership',
    input: { p_actor_id: ACTOR, p_brand_id: BRAND },
  }]);
  assert.equal(await ensurePlatformBrandMembership(db, 'bad', BRAND), null);
  assert.equal(calls.length, 1);
});
