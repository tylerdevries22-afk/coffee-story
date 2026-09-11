import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { encryptToken, loadTokenKey } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { retireDueSquareAccessTokens, SQUARE_RENEWAL_RETRY_MS } from './square-renewal';
import { BRAND, NOW, square, TOKEN_KEY, type UpdateRecord } from './square-renewal-test-support';

function retirementDb(
  rows: { id: string; brand_id: string; location_id: string;
    access_token_encrypted: string; retire_after: string }[],
  writes: UpdateRecord[],
): SupabaseClient {
  const query = {
    select: () => query,
    lte: () => query,
    order: () => query,
    limit: () => query,
    returns: async () => ({ data: rows, error: null }),
    update: (values: Record<string, unknown>) => {
      writes.push({ values, filters: {} });
      return claim;
    },
    delete: () => removed,
  };
  const claim = {
    eq: () => claim,
    select: () => claim,
    maybeSingle: async () => ({ data: { id: rows[0]?.id }, error: null }),
  };
  const removed = {
    eq: () => removed,
    select: () => removed,
    maybeSingle: async () => ({ data: { id: rows[0]?.id }, error: null }),
  };
  return { from: () => query } as unknown as SupabaseClient;
}

let realFetch: typeof globalThis.fetch;

describe('Square token retirement', () => {
  beforeEach(() => {
    realFetch = globalThis.fetch;
    process.env.SQUARE_TOKEN_KEY = TOKEN_KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.SQUARE_TOKEN_KEY;
  });

  it('revokes an expired token only after claiming and deletes its queue row', async () => {
    const old = encryptToken('retire-me', loadTokenKey());
    const revoked: string[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      revoked.push(String(JSON.parse(String(init?.body)).access_token));
      return new Response('{"success":true}', { status: 200 });
    }) as typeof globalThis.fetch;
    const writes: UpdateRecord[] = [];
    const summary = await retireDueSquareAccessTokens(retirementDb([{
      id: 'retirement', brand_id: BRAND, location_id: '22222222-2222-4222-8222-222222222222',
      access_token_encrypted: old,
      retire_after: new Date(NOW.getTime() - 1).toISOString(),
    }], writes), square, NOW);
    assert.deepEqual(summary, { scanned: 1, retired: 1, failed: 0, stale: 0, scanFailed: false });
    assert.deepEqual(revoked, ['retire-me']);
    assert.equal(
      writes[0]?.values.retire_after,
      new Date(NOW.getTime() + SQUARE_RENEWAL_RETRY_MS).toISOString(),
    );
  });
});
