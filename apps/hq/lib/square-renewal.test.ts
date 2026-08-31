import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { encryptToken, loadTokenKey, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  renewDueSquareConnections,
  renewSquareConnection,
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
  staleLocations: Set<string> = new Set(),
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
    returns: async () => ({ data: rows, error: null }),
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
        select: () => update,
        maybeSingle: async () => {
          const locationId = String(record.filters.location_id);
          return staleLocations.has(locationId)
            ? { data: null, error: null }
            : { data: { location_id: locationId }, error: null };
        },
      };
      return update;
    },
  };
  return { from: () => table } as unknown as SupabaseClient;
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
    globalThis.fetch = (async () => new Response(JSON.stringify({
      access_token: 'renewed-access',
      refresh_token: 'renewed-refresh',
      expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    }), { status: 200 })) as typeof globalThis.fetch;
    const updates: UpdateRecord[] = [];
    const first = row('22222222-2222-4222-8222-222222222222');
    const second = row('33333333-3333-4333-8333-333333333333');
    const db = renewalDb([first, second], updates, new Set([second.location_id]));

    assert.deepEqual(await renewDueSquareConnections(db, square, NOW), {
      scanned: 2, renewed: 1, failed: 0, stale: 1,
    });
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0]?.filters, {
      location_id: first.location_id,
      brand_id: BRAND,
      access_token_encrypted: first.access_token_encrypted,
      refresh_token_encrypted: first.refresh_token_encrypted,
    });
  });

  it('records a provider failure without replacing credentials', async () => {
    globalThis.fetch = (async () => { throw new Error('provider unavailable'); }) as typeof globalThis.fetch;
    const updates: UpdateRecord[] = [];
    const connection = row('22222222-2222-4222-8222-222222222222');

    assert.deepEqual(await renewSquareConnection(
      renewalDb([], updates), square, connection, NOW.getTime(),
    ), { outcome: 'failed' });
    assert.deepEqual(updates.map((update) => update.values), [{ expires_at: connection.expires_at }]);
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
  });
});
