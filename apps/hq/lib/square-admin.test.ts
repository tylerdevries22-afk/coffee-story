import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, loadTokenKey } from '@platform/engine';
import type { TenantClaims } from '@platform/schema';

import { disconnectSquare, recordSquareConnectionPointer, SquareAdminError } from './square-admin';

const BRAND = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';
const OTHER_LOCATION = '33333333-3333-4333-8333-333333333333';
const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

const owner: TenantClaims = { brand_id: BRAND, location_ids: [LOCATION], role: 'brand_owner' };
// No role at all: a signed-in user whose account was never assigned one.
const guest: TenantClaims = { brand_id: BRAND, location_ids: [] };
// A manager is trusted at their own store and nowhere else; an owner is
// trusted at every shop in the brand, so only a manager can test the refusal.
const manager: TenantClaims = { brand_id: BRAND, location_ids: [LOCATION], role: 'location_manager' };

type DbState = {
  connection: { access_token_encrypted: string } | null;
  deleteError: { message: string } | null;
  deleteResult?: { location_id: string } | null;
  /** Every table-and-verb this call touched, in order. */
  trail: string[];
  filters: Record<string, unknown>[];
};

function adminDb(state: DbState): SupabaseClient {
  const connection = {
    select: () => connection,
    eq: (column: string, value: unknown) => {
      state.filters.push({ [column]: value });
      return connection;
    },
    maybeSingle: async () => {
      state.trail.push('select');
      return { data: state.connection, error: null };
    },
    delete: () => {
      state.trail.push('delete');
      return deleted;
    },
  };
  const deleted = {
    eq: (column: string, value: unknown) => {
      state.filters.push({ [column]: value });
      return deleted;
    },
    select: () => deleted,
    maybeSingle: async () => ({
      data: state.deleteResult === undefined ? { location_id: LOCATION } : state.deleteResult,
      error: state.deleteError,
    }),
  };
  return { from: () => connection } as unknown as SupabaseClient;
}

function state(over: Partial<DbState> = {}): DbState {
  return {
    connection: { access_token_encrypted: encryptToken('stored-access', loadTokenKey()) },
    deleteError: null,
    trail: [],
    filters: [],
    ...over,
  };
}

let realFetch: typeof globalThis.fetch;
let revoked: unknown[];
let calls: number;

/**
 * Square's leg of the call, recorded into the same trail as the database's.
 *
 * One ordered list rather than two counters, because the order is the thing
 * under test: `['select', 'revoke', 'delete']` is the security property, and
 * any other permutation is a different function.
 */
function stubSquare(answer: 'ok' | 'unreachable', db?: DbState): void {
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    calls += 1;
    db?.trail.push('revoke');
    const body = init?.body ? JSON.parse(init.body) : {};
    revoked.push(body.access_token);
    if (answer === 'unreachable') throw new Error('Square is unreachable');
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
}

describe('disconnectSquare', () => {
  beforeEach(() => {
    realFetch = globalThis.fetch;
    revoked = [];
    calls = 0;
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

  it('tells Square before it deletes the only copy of the token', async () => {
    // The whole security argument for the order: the ciphertext in
    // square_connections is the only token the platform holds, so deleting it
    // first would strand a live merchant credential nothing could revoke.
    const db = state();
    stubSquare('ok', db);
    const result = await disconnectSquare(adminDb(db), owner, LOCATION);
    assert.deepEqual(result, { outcome: 'revoked' });
    assert.deepEqual(db.trail, ['select', 'revoke', 'delete']);
    assert.deepEqual(revoked, ['stored-access'], 'Square is sent the decrypted token, once');
  });

  it('scopes both the read and the delete to the caller\'s own brand', async () => {
    // A location id is readable with the anon key; the brand column is what
    // stops one tenant disconnecting another's shop by guessing one.
    stubSquare('ok');
    const db = state();
    await disconnectSquare(adminDb(db), owner, LOCATION);
    assert.ok(db.filters.some((filter) => filter.brand_id === BRAND), 'the read is brand-scoped');
    assert.equal(db.filters.filter((filter) => filter.brand_id === BRAND).length, 2,
      'both the read and the delete carry the brand');
    assert.equal(db.filters.filter((filter) => filter.location_id === LOCATION).length, 2);
  });

  it('still clears the connection when Square cannot be reached', async () => {
    // Refusing here would trap an owner disconnecting BECAUSE something is
    // wrong: the platform would keep billing to a merchant they no longer
    // trust, on the grounds that the merchant did not answer.
    const db = state();
    stubSquare('unreachable', db);
    assert.deepEqual(await disconnectSquare(adminDb(db), owner, LOCATION), { outcome: 'local_only' });
    // Attempted, then cleared anyway. fetchExternalWithRetry retries, so the
    // trail carries one entry per attempt.
    assert.deepEqual(db.trail.filter((step) => step !== 'revoke'), ['select', 'delete']);
    assert.ok(db.trail.includes('revoke'), 'Square was asked before the row went');
  });

  it('clears the connection when this deployment cannot read the token at all', async () => {
    // The rotated-key case docs/RUNBOOK.md already describes. Square cannot be
    // told from here, and the row must still go.
    // Built while the key is still readable: it is the deployment that loses
    // it, not the row.
    const db = state();
    stubSquare('ok', db);
    delete process.env.SQUARE_TOKEN_KEY;
    assert.deepEqual(await disconnectSquare(adminDb(db), owner, LOCATION), { outcome: 'local_only' });
    assert.equal(calls, 0, 'nothing is sent to Square without a token to revoke');
    assert.deepEqual(db.trail, ['select', 'delete']);
  });

  it('reports a revoked token whose row survived rather than calling it a no-op', async () => {
    stubSquare('ok');
    const db = state({ deleteError: { message: 'delete failed' } });
    assert.deepEqual(await disconnectSquare(adminDb(db), owner, LOCATION), { outcome: 'stranded' });
  });

  it('does not delete credentials written by a reconnect while revocation was in flight', async () => {
    stubSquare('ok');
    const db = state({ deleteResult: null });
    assert.deepEqual(await disconnectSquare(adminDb(db), owner, LOCATION), { outcome: 'stranded' });
    assert.ok(db.filters.some((filter) =>
      filter.access_token_encrypted === db.connection?.access_token_encrypted));
  });

  it('refuses a guest, a shop the caller does not manage, and one that is not connected', async () => {
    stubSquare('ok');
    for (const [claims, locationId, code] of [
      [guest, LOCATION, 'forbidden'],
      [manager, OTHER_LOCATION, 'forbidden'],
      [owner, '', 'invalid_request'],
    ] as const) {
      const db = state();
      await assert.rejects(
        () => disconnectSquare(adminDb(db), claims, locationId),
        (error: unknown) => error instanceof SquareAdminError && error.code === code,
      );
      assert.deepEqual(db.trail, [], 'a refusal reads nothing and deletes nothing');
    }

    const missing = state({ connection: null });
    await assert.rejects(
      () => disconnectSquare(adminDb(missing), owner, LOCATION),
      (error: unknown) => error instanceof SquareAdminError && error.code === 'not_connected',
    );
    assert.deepEqual(missing.trail, ['select'], 'nothing is deleted when there was no connection');
    assert.equal(calls, 0);
  });
});

describe('recordSquareConnectionPointer', () => {
  it('scopes the pointer to the brand and confirms the row was actually updated', async () => {
    const tables: string[] = [];
    const updates: unknown[] = [];
    const selections: string[] = [];
    const filters: Record<string, unknown>[] = [];
    const query = {
      update: (value: unknown) => {
        updates.push(value);
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push({ [column]: value });
        return query;
      },
      select: (columns: string) => {
        selections.push(columns);
        return query;
      },
      maybeSingle: async () => ({ data: { id: LOCATION }, error: null }),
    };
    const db = {
      from: (table: string) => {
        tables.push(table);
        return query;
      },
    } as unknown as SupabaseClient;

    assert.equal(await recordSquareConnectionPointer(db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), true);
    assert.deepEqual(tables, ['locations']);
    assert.deepEqual(updates, [{ square_connection_id: 'connection' }]);
    assert.deepEqual(filters, [{ id: LOCATION }, { brand_id: BRAND }]);
    assert.deepEqual(selections, ['id']);
  });

  it('does not call a zero-row update success', async () => {
    const query = {
      update: () => query,
      eq: () => query,
      select: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;

    assert.equal(await recordSquareConnectionPointer(db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), false);
  });

  it('does not call a failed update success', async () => {
    const query = {
      update: () => query,
      eq: () => query,
      select: () => query,
      maybeSingle: async () => ({ data: null, error: { message: 'write failed' } }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;

    assert.equal(await recordSquareConnectionPointer(db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), false);
  });

  it('keeps a rejected compatibility write from failing the connection', async () => {
    const query = {
      update: () => query,
      eq: () => query,
      select: () => query,
      maybeSingle: async () => { throw new Error('network failed'); },
    };
    const db = { from: () => query } as unknown as SupabaseClient;

    assert.equal(await recordSquareConnectionPointer(db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), false);
  });
});
