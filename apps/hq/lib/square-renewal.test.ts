import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { encryptToken, loadTokenKey, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  renewDueSquareConnections,
  renewSquareConnection,
  retireDueSquareAccessTokens,
  SQUARE_ACCESS_TOKEN_RETIREMENT_BATCH_SIZE,
  SQUARE_RENEWAL_BATCH_SIZE,
  SQUARE_RENEWAL_RETRY_MS,
  squareRenewalBackoffActive,
  type SquareRenewalConnection,
} from './square-renewal';

const BRAND = '11111111-1111-4111-8111-111111111111';
const TOKEN_KEY = Buffer.alloc(32, 9).toString('base64');
const NOW = new Date('2026-08-31T06:00:00.000Z');
const DAY = 24 * 60 * 60 * 1_000;
const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret', apiBase: 'https://square.test',
};

type UpdateRecord = {
  values: Record<string, unknown>;
  filters: Record<string, unknown>;
};

function row(locationId: string): SquareRenewalConnection {
  const key = loadTokenKey();
  return {
    brand_id: BRAND,
    location_id: locationId,
    access_token_encrypted: encryptToken(`access-${locationId}`, key),
    refresh_token_encrypted: encryptToken(`refresh-${locationId}`, key),
    expires_at: new Date(NOW.getTime() + DAY).toISOString(),
    updated_at: new Date(NOW.getTime() - DAY).toISOString(),
  };
}

function renewalDb(
  rows: SquareRenewalConnection[],
  updates: UpdateRecord[],
  options: {
    staleClaims?: Set<string>;
    stalePersists?: Set<string>;
    queryError?: { message: string };
    retirementWrites?: Record<string, unknown>[];
    retirementError?: { code?: string };
  } = {},
): SupabaseClient {
  const queryFilters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    not: (column: string, operator: string, value: unknown) => {
      queryFilters.not = { column, operator, value };
      return query;
    },
    lte: (column: string, value: unknown) => {
      queryFilters.lte = { column, value };
      return query;
    },
    or: (value: string) => {
      queryFilters.or = value;
      return query;
    },
    order: (column: string, options: unknown) => {
      queryFilters.order = { column, options };
      return query;
    },
    limit: (value: number) => {
      queryFilters.limit = value;
      return query;
    },
    returns: async () => ({ data: rows, error: options.queryError ?? null }),
  };
  const table = {
    ...query,
    update: (values: Record<string, unknown>) => {
      const record: UpdateRecord = { values, filters: {} };
      updates.push(record);
      const update = {
        eq: (column: string, value: unknown) => {
          record.filters[column] = value;
          return update;
        },
        is: (column: string, value: unknown) => {
          record.filters[column] = value;
          return update;
        },
        select: () => update,
        maybeSingle: async () => {
          const locationId = String(record.filters.location_id);
          const isClaim = Object.keys(record.values).length === 1 && 'expires_at' in record.values;
          const stale = isClaim
            ? options.staleClaims?.has(locationId)
            : options.stalePersists?.has(locationId);
          return stale
            ? { data: null, error: null }
            : { data: { location_id: locationId }, error: null };
        },
      };
      return update;
    },
  };
  const retirement = {
    insert: (values: Record<string, unknown>) => {
      options.retirementWrites?.push(values);
      return retirement;
    },
    select: () => retirement,
    maybeSingle: async () => ({
      data: options.retirementError ? null : { id: 'retirement' },
      error: options.retirementError ?? null,
    }),
  };
  return {
    from: (tableName: string) => tableName === 'square_access_token_retirements' ? retirement : table,
  } as unknown as SupabaseClient;
}

function retirementDb(
  rows: Array<{
    id: string;
    brand_id: string;
    location_id: string;
    access_token_encrypted: string;
    retire_after: string;
  }>,
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

describe('Square token renewal', () => {
  beforeEach(() => {
    realFetch = globalThis.fetch;
    process.env.SQUARE_TOKEN_KEY = TOKEN_KEY;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.SQUARE_TOKEN_KEY;
  });

  it('renews a bounded due batch and reports a lost compare-and-set', async () => {
    const revoked: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/oauth2/revoke')) {
        revoked.push(String(JSON.parse(String(init?.body)).access_token));
        return new Response('{"success":true}', { status: 200 });
      }
      return new Response(JSON.stringify({
        access_token: 'renewed-access',
        refresh_token: 'renewed-refresh',
        expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      }), { status: 200 });
    }) as typeof globalThis.fetch;
    const updates: UpdateRecord[] = [];
    const first = row('22222222-2222-4222-8222-222222222222');
    const second = row('33333333-3333-4333-8333-333333333333');
    const retirementWrites: Record<string, unknown>[] = [];
    const db = renewalDb([first, second], updates, {
      stalePersists: new Set([second.location_id]),
      retirementWrites,
    });

    assert.deepEqual(await renewDueSquareConnections(db, square, NOW), {
      scanned: 2, renewed: 1, failed: 0, stale: 1, scanFailed: false, cleanupFailed: 0,
    });
    assert.equal(updates.length, 4);
    assert.deepEqual(updates[0]?.filters, {
      location_id: first.location_id,
      brand_id: BRAND,
      access_token_encrypted: first.access_token_encrypted,
      refresh_token_encrypted: first.refresh_token_encrypted,
      updated_at: first.updated_at,
    });
    assert.deepEqual(revoked, ['renewed-access'], 'only the unpersisted new token is safe to revoke immediately');
    assert.equal(retirementWrites[0]?.access_token_encrypted, first.access_token_encrypted,
      'the old credential stays usable briefly for an in-flight checkout or refund');
    assert.equal(retirementWrites[0]?.brand_id, BRAND);
    assert.equal(retirementWrites[0]?.location_id, first.location_id);
  });

  it('claims the exact snapshot before calling Square', async () => {
    let refreshCalls = 0;
    globalThis.fetch = (async () => {
      refreshCalls += 1;
      throw new Error('must not be called');
    }) as typeof globalThis.fetch;
    const updates: UpdateRecord[] = [];
    const connection = row('22222222-2222-4222-8222-222222222222');

    assert.deepEqual(await renewSquareConnection(
      renewalDb([], updates, { staleClaims: new Set([connection.location_id]) }),
      square,
      connection,
      NOW.getTime(),
    ), { outcome: 'stale', stage: 'claim', cleanupFailed: false });
    assert.equal(refreshCalls, 0);
    assert.equal(updates.length, 1);
  });

  it('records a provider failure without replacing credentials', async () => {
    globalThis.fetch = (async () => { throw new Error('provider unavailable'); }) as typeof globalThis.fetch;
    const updates: UpdateRecord[] = [];
    const connection = row('22222222-2222-4222-8222-222222222222');

    assert.deepEqual(await renewSquareConnection(
      renewalDb([], updates), square, connection, NOW.getTime(),
    ), { outcome: 'failed', cleanupFailed: false });
    assert.deepEqual(updates.map((update) => update.values), [{ expires_at: connection.expires_at }]);
  });

  it('reports a failed database scan without throwing out the maintenance tick', async () => {
    const summary = await renewDueSquareConnections(
      renewalDb([], [], { queryError: { message: 'read unavailable' } }), square, NOW,
    );
    assert.deepEqual(summary, {
      scanned: 0, renewed: 0, failed: 0, stale: 0, scanFailed: true, cleanupFailed: 0,
    });
  });

  it('keeps a successful renewal usable while reporting a failed retirement queue write', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        access_token: 'renewed-access',
        refresh_token: 'renewed-refresh',
        expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      }), { status: 200 });
    }) as typeof globalThis.fetch;
    const connection = row('22222222-2222-4222-8222-222222222222');
    const result = await renewSquareConnection(
      renewalDb([], [], { retirementError: { code: 'write_failed' } }), square, connection, NOW.getTime(),
    );
    assert.deepEqual(result, {
      outcome: 'renewed', accessToken: 'renewed-access', cleanupFailed: true,
    });
  });

  it('uses a strict retry cooldown and exposes the bounded batch size', () => {
    assert.equal(squareRenewalBackoffActive(
      new Date(NOW.getTime() - SQUARE_RENEWAL_RETRY_MS + 1).toISOString(), NOW.getTime(),
    ), true);
    assert.equal(squareRenewalBackoffActive(
      new Date(NOW.getTime() - SQUARE_RENEWAL_RETRY_MS).toISOString(), NOW.getTime(),
    ), false);
    assert.equal(squareRenewalBackoffActive('not-a-date', NOW.getTime()), false);
    assert.equal(SQUARE_RENEWAL_BATCH_SIZE, 10);
    assert.equal(SQUARE_ACCESS_TOKEN_RETIREMENT_BATCH_SIZE, 10);
  });

  it('revokes an expired grace-period token only after claiming and deleting its queue row', async () => {
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
    assert.equal(writes[0]?.values.retire_after, new Date(NOW.getTime() + SQUARE_RENEWAL_RETRY_MS).toISOString());
  });
});
