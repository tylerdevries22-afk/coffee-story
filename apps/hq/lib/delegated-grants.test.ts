import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { delegatedGrantsOf, loadIssuedGrants } from './delegated-grants';

type Result = { data: unknown; error: unknown };

function fakeClient(result: Result, filters: Record<string, unknown>[] = []): SupabaseClient {
  const builder = {
    eq: (column: string, value: unknown) => { filters.push({ eq: column, value }); return builder; },
    gt: (column: string, value: unknown) => { filters.push({ gt: column, value }); return builder; },
    is: (column: string, value: unknown) => { filters.push({ is: column, value }); return builder; },
    limit: () => builder,
    order: () => builder,
    returns: () => Promise.resolve(result),
    select: () => builder,
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

function grantRow(over: Record<string, unknown> = {}) {
  return {
    expires_at: '2026-09-20T00:00:00.000Z',
    grantee_user_id: '00000000-0000-4000-8000-00000000000a',
    id: '00000000-0000-4000-8000-000000000001',
    network_id: '00000000-0000-4000-8000-0000000000ff',
    scope: ['network:kpis'],
    ...over,
  };
}

describe('delegatedGrantsOf', () => {
  it('orders grants by the soonest expiry, since that is the one about to lapse', () => {
    const grants = delegatedGrantsOf([
      grantRow({ id: 'later', expires_at: '2026-09-30T00:00:00.000Z' }),
      grantRow({ id: 'sooner', expires_at: '2026-09-05T00:00:00.000Z' }),
    ]);
    assert.deepEqual(grants.map((grant) => grant.id), ['sooner', 'later']);
  });

  /**
   * A row that does not parse is dropped rather than rendered: an "Invalid
   * Date" beside a revoke button reads as a broken grant rather than a broken
   * row, and the button would still work on a grant nobody can describe.
   */
  it('drops a row it cannot describe', () => {
    assert.deepEqual(delegatedGrantsOf([
      grantRow({ expires_at: 'whenever' }),
      grantRow({ grantee_user_id: 42 }),
      grantRow({ id: null }),
      grantRow({ network_id: undefined }),
      'not-a-row',
      null,
    ]), []);
    assert.deepEqual(delegatedGrantsOf('not-an-array'), []);
  });

  it('tolerates a null or mixed scope array without inventing entries', () => {
    const [nulled, mixed] = delegatedGrantsOf([
      grantRow({ id: 'a', scope: null, expires_at: '2026-09-05T00:00:00.000Z' }),
      grantRow({ id: 'b', scope: ['network:kpis', 7, null] }),
    ]);
    assert.deepEqual(nulled?.scope, []);
    assert.deepEqual(mixed?.scope, ['network:kpis']);
  });
});

describe('loadIssuedGrants', () => {
  /**
   * Scoped by brand_id, not left to RLS alone. A session that is both a brand
   * owner and somebody else's delegate reads both sets of rows under
   * delegated_access_grants_select, and revoke_delegated_access would refuse
   * the ones it does not own -- a control that lies.
   */
  it('asks only for its own brand, unrevoked and unexpired', async () => {
    const filters: Record<string, unknown>[] = [];
    const grants = await loadIssuedGrants(
      'brand-1', fakeClient({ data: [grantRow()], error: null }, filters),
    );
    assert.equal(grants.length, 1);
    assert.deepEqual(filters[0], { eq: 'brand_id', value: 'brand-1' });
    assert.deepEqual(filters[1], { is: 'revoked_at', value: null });
    assert.equal(filters[2]?.gt, 'expires_at');
  });

  it('reads nothing when there is no brand or no client', async () => {
    assert.deepEqual(await loadIssuedGrants(null), []);
    assert.deepEqual(await loadIssuedGrants('brand-1', null), []);
  });

  it('treats a refusal as an empty list rather than an error', async () => {
    assert.deepEqual(
      await loadIssuedGrants('brand-1', fakeClient({ data: null, error: { message: 'denied' } })),
      [],
    );
  });
});
