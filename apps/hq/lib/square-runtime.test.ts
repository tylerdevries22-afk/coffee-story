import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  BRAND,
  DAY,
  LOCATION,
  TOKEN_KEY,
  at,
  connectionRow,
  type DbState,
  resolve,
  squareTestState,
  stubSquare,
} from './square-runtime-test-support';

describe('squareRuntimeFor', () => {
  beforeEach(() => {
    squareTestState.realFetch = globalThis.fetch;
    process.env.SQUARE_APP_ID = 'app';
    process.env.SQUARE_APP_SECRET = 'secret';
    process.env.SQUARE_TOKEN_KEY = TOKEN_KEY;
  });
  afterEach(() => {
    globalThis.fetch = squareTestState.realFetch;
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
    assert.equal(squareTestState.refreshCalls, 0, 'a fresh token must not cost a round trip');
    assert.equal(state.updates.length, 0);
  });

  it('renews a token near its expiry and stores what came back', async () => {
    stubSquare({ ok: true, body: { access_token: 'renewed', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY) }), updates: [], updateFilters: [], retirementWrites: [],
    };
    const runtime = await resolve(state);
    assert.equal(runtime?.locationAccessToken, 'renewed');
    assert.equal(squareTestState.refreshCalls, 1);
    assert.equal(state.updates.length, 2);
    assert.deepEqual(state.updates[0], { expires_at: state.connection?.expires_at },
      'the first write atomically claims this authorization snapshot');
    const written = state.updates[1] ?? {};
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
    assert.equal(state.updateFilters?.[4]?.updated_at, state.connection?.updated_at,
      'overlapping workers may only claim the exact version they read');
    assert.equal(state.retirementWrites?.[0]?.access_token_encrypted, state.connection?.access_token_encrypted,
      'the previous runtime is queued instead of revoked while a payment may still be using it');
    assert.equal(state.retirementWrites?.[0]?.brand_id, BRAND);
    assert.equal(state.retirementWrites?.[0]?.location_id, LOCATION);
  });

  it('does not spend a renewed token when reconnect replaced the authorization mid-refresh', async () => {
    stubSquare({ ok: true, body: { access_token: 'stale-renewal', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY) }),
      updates: [],
      updateResults: [
        { data: { location_id: LOCATION }, error: null },
        { data: null, error: null },
      ],
    };
    assert.equal(await resolve(state), null,
      'the stored token and merchant location both became stale when the compare-and-set lost');
  });

  it('keeps using an unexpired token when another worker owns the renewal claim', async () => {
    stubSquare({ ok: true });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY) }),
      updates: [],
      updateResults: [{ data: null, error: null }],
    };
    const runtime = await resolve(state);
    assert.equal(runtime?.locationAccessToken, 'stored-access');
    assert.equal(squareTestState.refreshCalls, 0, 'the losing worker must not call Square');
  });

  it('does not use an expired token when another worker owns renewal', async () => {
    stubSquare({ ok: true });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(-DAY) }),
      updates: [],
      updateResults: [{ data: null, error: null }],
    };
    assert.equal(await resolve(state), null);
    assert.equal(squareTestState.refreshCalls, 0);
  });

  it('refuses an expired token when its refresh write loses a reconnect race', async () => {
    stubSquare({ ok: true, body: { access_token: 'stale-renewal', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(-DAY) }),
      updates: [],
      updateResults: [
        { data: { location_id: LOCATION }, error: null },
        { data: null, error: null },
      ],
    };
    assert.equal(await resolve(state), null);
  });

  it('fails closed when the renewed credentials cannot be persisted', async () => {
    stubSquare({ ok: true, body: { access_token: 'renewed', refresh_token: 'next-refresh', expires_at: at(30 * DAY) } });
    const state: DbState = {
      connection: connectionRow({ expires_at: at(DAY) }),
      updates: [],
      updateResults: [
        { data: { location_id: LOCATION }, error: null },
        { data: null, error: { message: 'write failed' } },
      ],
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
    assert.equal(squareTestState.refreshCalls, 0);
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
