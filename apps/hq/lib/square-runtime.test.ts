import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, loadTokenKey } from '@platform/engine';

import { squareRuntimeFor, type BrandFeeRow } from './square-runtime';

const BRAND = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';
const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

const brand: BrandFeeRow = { fee_bps: 250, fee_bps_tier2: 150, tier_threshold_cents: 500_000 };

type ConnectionRow = {
  square_location_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  updated_at: string | null;
};

type DbState = {
  connection: ConnectionRow | null;
  updates: Record<string, unknown>[];
  updateFilters?: Record<string, unknown>[];
  updateResult?: { data: { location_id: string } | null; error: { message: string } | null };
};

/**
 * The two rows `squareRuntimeFor` reads, and a record of what it writes back.
 * `from` is dispatched on the table name because the connection and the
 * location are read in parallel from the same client.
 */
function runtimeDb(state: DbState): SupabaseClient {
  const location = {
    select: () => location,
    eq: () => location,
    maybeSingle: async () => ({
      data: { id: LOCATION, timezone: 'America/Denver', fee_bps: null, fee_bps_tier2: null, tier_threshold_cents: null },
      error: null,
    }),
  };
  const connection = {
    select: () => connection,
    eq: () => connection,
    maybeSingle: async () => ({ data: state.connection, error: null }),
    update: (values: Record<string, unknown>) => {
      state.updates.push(values);
      const update = {
        eq: (column: string, value: unknown) => {
          state.updateFilters?.push({ [column]: value });
          return update;
        },
        select: () => update,
        maybeSingle: async () => state.updateResult ?? {
          data: { location_id: LOCATION }, error: null,
        },
      };
      return update;
    },
  };
  return { from: (table: string) => (table === 'locations' ? location : connection) } as unknown as SupabaseClient;
}

const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
const DAY = 24 * 60 * 60 * 1000;

let realFetch: typeof globalThis.fetch;
let refreshCalls: number;

function stubSquare(response: { ok: boolean; body?: unknown }): void {
  refreshCalls = 0;
  globalThis.fetch = (async () => {
    refreshCalls += 1;
    if (!response.ok) throw new Error('Square is unreachable');
    return new Response(JSON.stringify(response.body ?? {}), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

function connectionRow(over: Partial<ConnectionRow> = {}): ConnectionRow {
  const key = loadTokenKey();
  return {
    square_location_id: 'SQ-LOC',
    access_token_encrypted: encryptToken('stored-access', key),
    refresh_token_encrypted: encryptToken('stored-refresh', key),
    expires_at: at(60 * DAY),
    updated_at: at(-DAY),
    ...over,
  };
}

const resolve = (state: DbState) =>
  squareRuntimeFor(runtimeDb(state), { brandId: BRAND, locationId: LOCATION, brand });

describe('squareRuntimeFor', () => {
  beforeEach(() => {
    realFetch = globalThis.fetch;
    process.env.SQUARE_APP_ID = 'app';
    process.env.SQUARE_APP_SECRET = 'secret';
    process.env.SQUARE_TOKEN_KEY = TOKEN_KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.SQUARE_APP_ID;
    delete process.env.SQUARE_APP_SECRET;
    delete process.env.SQUARE_TOKEN_KEY;
  });

  it('refuses a connection that never bound a Square location', async () => {
    // The defect this file exists for: consent stored tokens, nothing recorded
    // which Square location to bill, and every card order answered 503.
    stubSquare({ ok: true });
    const state: DbState = { connection: connectionRow({ square_location_id: null }), updates: [] };
    assert.equal(await resolve(state), null);
  });

  it('spends a healthy token without calling Square', async () => {
    stubSquare({ ok: true });
    const state: DbState = { connection: connectionRow(), updates: [] };
    const runtime = await resolve(state);
    assert.equal(runtime?.locationAccessToken, 'stored-access');
    assert.equal(refreshCalls, 0, 'a fresh token must not cost a round trip');
    assert.equal(state.updates.length, 0);
  });

  it('renews a token near its expiry and stores what came back', async () => {
    stubSquare({ ok: true, body: { access_token: 'renewed', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY) }), updates: [], updateFilters: [],
    };
    const runtime = await resolve(state);
    assert.equal(runtime?.locationAccessToken, 'renewed');
    assert.equal(refreshCalls, 1);
    assert.equal(state.updates.length, 1);
    const written = state.updates[0] ?? {};
    assert.ok(typeof written.access_token_encrypted === 'string');
    assert.ok(typeof written.refresh_token_encrypted === 'string', 'a reissued refresh token must be kept');
    assert.ok(typeof written.expires_at === 'string', 'the new expiry is what stops the next order renewing again');
    assert.notEqual(written.access_token_encrypted, state.connection?.access_token_encrypted);
    assert.deepEqual(state.updateFilters?.slice(0, 2), [
      { location_id: LOCATION }, { brand_id: BRAND },
    ], 'the service-role write is tenant-scoped');
    assert.equal(state.updateFilters?.[2]?.access_token_encrypted, state.connection?.access_token_encrypted);
    assert.equal(state.updateFilters?.[3]?.refresh_token_encrypted, state.connection?.refresh_token_encrypted,
      'the write may only replace the exact authorization snapshot that was traded');
  });

  it('does not spend a renewed token when reconnect replaced the authorization mid-refresh', async () => {
    stubSquare({ ok: true, body: { access_token: 'stale-renewal', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY) }),
      updates: [],
      updateResult: { data: null, error: null },
    };
    assert.equal(await resolve(state), null,
      'the stored token and merchant location both became stale when the compare-and-set lost');
  });

  it('refuses an expired token when its refresh write loses a reconnect race', async () => {
    stubSquare({ ok: true, body: { access_token: 'stale-renewal', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(-DAY) }),
      updates: [],
      updateResult: { data: null, error: null },
    };
    assert.equal(await resolve(state), null);
  });

  it('fails closed when the renewed credentials cannot be persisted', async () => {
    stubSquare({ ok: true, body: { access_token: 'renewed', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY) }),
      updates: [],
      updateResult: { data: null, error: { message: 'write failed' } },
    };
    assert.equal(await resolve(state), null);
  });

  it('still takes the sale when a renewal fails but the token has not expired', async () => {
    stubSquare({ ok: false });
    const state: DbState = { connection: connectionRow({ expires_at: at(DAY) }), updates: [] };
    const runtime = await resolve(state);
    assert.equal(runtime?.locationAccessToken, 'stored-access');
    assert.deepEqual(state.updates, [{ expires_at: state.connection?.expires_at }],
      'the no-op write starts the shared retry cooldown');
  });

  it('does not hammer Square again during the renewal cooldown', async () => {
    stubSquare({ ok: true, body: { access_token: 'renewed', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY), updated_at: at(-60_000) }), updates: [],
    };
    const runtime = await resolve(state);
    assert.equal(runtime?.locationAccessToken, 'stored-access');
    assert.equal(refreshCalls, 0);
    assert.equal(state.updates.length, 0);
  });

  it('refuses rather than send Square a token that has expired', async () => {
    stubSquare({ ok: false });
    const state: DbState = { connection: connectionRow({ expires_at: at(-DAY) }), updates: [] };
    assert.equal(await resolve(state), null);
  });

  it('refuses an expired token with no refresh token to trade', async () => {
    stubSquare({ ok: true });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(-DAY), refresh_token_encrypted: null }), updates: [],
    };
    assert.equal(await resolve(state), null);
  });

  it('is unavailable, not broken, when this deployment has no Square credentials', async () => {
    delete process.env.SQUARE_APP_ID;
    stubSquare({ ok: true });
    const state: DbState = { connection: connectionRow(), updates: [] };
    assert.equal(await resolve(state), null);
  });
});
