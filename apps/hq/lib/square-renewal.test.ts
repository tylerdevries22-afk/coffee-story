import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  renewDueSquareConnections,
  renewSquareConnection,
  SQUARE_ACCESS_TOKEN_RETIREMENT_BATCH_SIZE,
  SQUARE_RENEWAL_BATCH_SIZE,
  SQUARE_RENEWAL_RETRY_MS,
  squareRenewalBackoffActive,
} from './square-renewal';
import {
  BRAND,
  DAY,
  NOW,
  renewalDb,
  renewalRow,
  square,
  TOKEN_KEY,
  type RpcCall,
} from './square-renewal-test-support';

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
    const calls: RpcCall[] = [];
    const first = renewalRow('22222222-2222-4222-8222-222222222222');
    const second = renewalRow('33333333-3333-4333-8333-333333333333');
    const retirementWrites: Record<string, unknown>[] = [];
    const db = renewalDb([first, second], calls, {
      stalePersists: new Set([second.location_id]),
      retirementWrites,
    });

    assert.deepEqual(await renewDueSquareConnections(db, square, NOW), {
      scanned: 2, renewed: 1, failed: 0, stale: 1, scanFailed: false, cleanupFailed: 0,
    });
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0], {
      name: 'claim_square_connection_mutation',
      args: {
        p_brand_id: BRAND,
        p_location_id: first.location_id,
        p_mutation_generation: calls[0]?.args.p_mutation_generation,
        p_mutation_kind: 'renew',
        p_expected_connection_id: first.id,
        p_expected_connection_generation: first.connection_generation,
        p_expected_access_token_encrypted: first.access_token_encrypted,
        p_expected_refresh_token_encrypted: first.refresh_token_encrypted,
      },
    });
    assert.deepEqual(revoked, ['renewed-access']);
    assert.equal(retirementWrites[0]?.access_token_encrypted, first.access_token_encrypted);
    assert.equal(retirementWrites[0]?.brand_id, BRAND);
    assert.equal(retirementWrites[0]?.location_id, first.location_id);
  });

  it('claims the exact snapshot before calling Square', async () => {
    let refreshCalls = 0;
    globalThis.fetch = (async () => {
      refreshCalls += 1;
      throw new Error('must not be called');
    }) as typeof globalThis.fetch;
    const calls: RpcCall[] = [];
    const connection = renewalRow('22222222-2222-4222-8222-222222222222');

    assert.deepEqual(await renewSquareConnection(
      renewalDb([connection], calls, { staleClaims: new Set([connection.location_id]) }),
      square,
      connection,
      NOW.getTime(),
    ), { outcome: 'stale', stage: 'claim', cleanupFailed: false });
    assert.equal(refreshCalls, 0);
    assert.deepEqual(calls.map((call) => call.name), ['claim_square_connection_mutation']);
  });

  it('continues an exact same-generation claim after its first response is lost', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      access_token: 'renewed-access',
      refresh_token: 'renewed-refresh',
      expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    }), { status: 200 })) as typeof globalThis.fetch;
    const connection = renewalRow('22222222-2222-4222-8222-222222222222');
    const calls: RpcCall[] = [];
    const result = await renewSquareConnection(
      renewalDb([connection], calls, {
        lostClaimResponses: new Set([connection.location_id]),
      }),
      square,
      connection,
      NOW.getTime(),
    );
    assert.equal(result.outcome, 'renewed');
    assert.deepEqual(calls.map((call) => call.name), [
      'claim_square_connection_mutation',
      'claim_square_connection_mutation',
      'finalize_square_connection_renewal',
    ]);
    assert.equal(calls[0]?.args.p_mutation_generation, calls[1]?.args.p_mutation_generation);
  });

  it('records a provider failure without replacing credentials', async () => {
    globalThis.fetch = (async () => { throw new Error('provider unavailable'); }) as typeof globalThis.fetch;
    const calls: RpcCall[] = [];
    const connection = renewalRow('22222222-2222-4222-8222-222222222222');

    assert.deepEqual(await renewSquareConnection(
      renewalDb([connection], calls), square, connection, NOW.getTime(),
    ), { outcome: 'failed', cleanupFailed: false });
    assert.deepEqual(calls.map((call) => call.name), ['claim_square_connection_mutation']);
  });

  it('reports a failed database scan without throwing out the maintenance tick', async () => {
    const summary = await renewDueSquareConnections(
      renewalDb([], [], { queryError: { message: 'read unavailable' } }), square, NOW,
    );
    assert.deepEqual(summary, {
      scanned: 0, renewed: 0, failed: 0, stale: 0, scanFailed: true, cleanupFailed: 0,
    });
  });

  it('reports a failed retirement queue write while keeping the new token usable', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      access_token: 'renewed-access',
      refresh_token: 'renewed-refresh',
      expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    }), { status: 200 })) as typeof globalThis.fetch;
    const connection = renewalRow('22222222-2222-4222-8222-222222222222');
    assert.deepEqual(await renewSquareConnection(
      renewalDb([connection], [], { retirementError: { code: 'write_failed' } }),
      square,
      connection,
      NOW.getTime(),
    ), {
      outcome: 'renewed', accessToken: 'renewed-access',
      connectionGeneration: '66666666-6666-4666-8666-666666666666', cleanupFailed: true,
    });
  });

  it('uses a strict retry cooldown and exposes bounded batch sizes', () => {
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
});
