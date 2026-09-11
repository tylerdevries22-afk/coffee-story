import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ConnectorExchangeError } from './connector-oauth-exchange';
import { ConnectorIdentityError } from './connector-oauth-identity';

type Dependencies = typeof import('./connector-oauth-callback-dependencies')['connectorOAuthCallbackDependencies'];
type CallbackGet = typeof import('../app/api/connectors/[provider]/callback/route')['GET'];
let dependencies: Dependencies;
let callbackGet: CallbackGet;
let original: Dependencies;
const BRAND = '11111111-1111-4111-8111-111111111111';
const INSTALLATION = '22222222-2222-4222-8222-222222222222';
const OPERATION = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const REFERENCE = '55555555-5555-4555-8555-555555555555';
const STATE = '66666666-6666-4666-8666-666666666666';
const BINDING_HASH = 'b'.repeat(64);
const PROCESSING_LEASE = '77777777-7777-4777-8777-777777777777';
const EXCHANGE_ATTEMPT = '88888888-8888-4888-8888-888888888888';

before(async () => {
  registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === 'server-only'
      ? nextResolve(specifier, { ...context, conditions: [...context.conditions, 'react-server'] })
      : nextResolve(specifier, context);
  } });
  ({ connectorOAuthCallbackDependencies: dependencies } = await import('./connector-oauth-callback-dependencies'));
  ({ GET: callbackGet } = await import('../app/api/connectors/[provider]/callback/route'));
  original = { ...dependencies };
});

afterEach(() => {
  Object.assign(dependencies, original);
  mock.restoreAll();
});

function setup(overrides: Readonly<Record<string, unknown>> = {}) {
  const calls = {
    complete: 0, exchange: 0,
    compensations: [] as Readonly<Record<string, unknown>>[],
  };
  const db = {} as SupabaseClient;
  Object.assign(dependencies, {
    authorize: async () => ({ brandId: BRAND, db, userId: USER }),
    callbackUrl: (provider: string) => `https://hq.example.test/api/connectors/${provider}/callback`,
    compensate: async (_db: SupabaseClient, input: Readonly<Record<string, unknown>>) => {
      calls.compensations.push(input);
      return { outcome: 'cleanup_queued' as const, referenceId: REFERENCE };
    },
    complete: async () => { calls.complete += 1; return INSTALLATION; },
    consumeState: async () => ({ data: [{
      state_id: STATE, brand_id: BRAND, installation_id: INSTALLATION,
      cookie_binding_hash: BINDING_HASH, consume_key: OPERATION,
      requested_scopes: ['channels:read', 'chat:write'], consume_replayed: false,
      completion_outcome: null, completed_reference_id: null,
      processing_lease_token: PROCESSING_LEASE,
      processing_lease_expires_at: '2026-09-08T12:02:00.000Z',
      processing_generation: 1, processing_acquired: true, exchange_started: false,
      redirect_uri: 'https://hq.example.test/api/connectors/slack/callback',
    }], error: null }),
    cookieName: (_provider: string, nonce: string) => `oauth-${nonce}`,
    exchange: async () => {
      calls.exchange += 1;
      return { access_token: 'issued-token', refresh_token: 'refresh-token',
        expires_in: 3_600, scope: 'channels:read,chat:write' };
    },
    hasGrant: () => true,
    identity: async () => ({ accountId: 'workspace-1', accountLabel: 'Workspace' }),
    isProvider: (provider: string) => provider === 'slack',
    newOperationKey: () => EXCHANGE_ATTEMPT,
    now: () => new Date('2026-09-08T12:00:00.000Z'),
    parseCookie: () => ({ binding: 'binding-value-that-is-long-enough',
      operationKey: OPERATION, verifier: 'v'.repeat(43) }),
    providerReady: () => true,
    resolveScopes: async () => ['channels:read', 'chat:write'],
    sha256: (value: string) => value === 'nonce' ? 'a'.repeat(64) : BINDING_HASH,
    startExchange: async () => true,
    verifyState: () => ({ nonce: 'nonce' }),
    ...overrides,
  });
  return calls;
}

async function invoke(provider = 'slack'): Promise<Response> {
  const request = new Request(
    `https://hq.example.test/api/connectors/${provider}/callback?state=signed&code=code`,
  );
  return callbackGet(request, { params: Promise.resolve({ provider }) });
}

function outcome(response: Response): string { return response.headers.get('location') ?? ''; }

describe('connector OAuth callback failures', { concurrency: false }, () => {
  it('treats wrong binding and redirect ownership as invalid state', async () => {
    for (const override of [
      { consumeState: async () => ({ data: [], error: null }) },
      { callbackUrl: () => 'https://hq.example.test/different-callback' },
    ]) {
      const calls = setup(override);
      assert.match(outcome(await invoke()), /connection=invalid_state/u);
      assert.equal(calls.exchange, 0);
      Object.assign(dependencies, original);
    }
  });

  it('reports thrown, returned, and malformed consume failures as safe storage errors', async (t) => {
    const logs: string[] = [];
    t.mock.method(console, 'error', (line: string) => { logs.push(line); });
    for (const consumeState of [
      async () => { throw new Error('private database detail'); },
      async () => ({ data: null, error: { message: 'private database detail' } }),
      async () => ({ data: [{ brand_id: 'malformed' }], error: null }),
    ]) {
      setup({ consumeState });
      assert.match(outcome(await invoke()), /connection=connection_failed/u);
      assert.equal(logs.pop(), 'connector.oauth.callback provider=slack stage=storage');
      Object.assign(dependencies, original);
    }
    assert.ok(!logs.join('').includes('private database detail'));
  });

  it('returns the shared authorization denial without consuming state', async () => {
    let consumed = false;
    setup({ authorize: async () => new Response('Owner required.', { status: 403 }),
      consumeState: async () => { consumed = true; return { data: [], error: null }; } });
    assert.equal((await invoke()).status, 403);
    assert.equal(consumed, false);
  });

  it('hands every post-issuance failure to durable compensation', async (t) => {
    t.mock.method(console, 'error', () => undefined);
    for (const override of [
      { resolveScopes: async () => null },
      { hasGrant: () => false },
      { identity: async () => { throw new ConnectorIdentityError(); } },
      { providerReady: () => false },
      { exchange: async () => ({ access_token: 'issued-token', refresh_token: 'refresh-token',
        expires_in: 0, scope: 'channels:read,chat:write' }) },
    ]) {
      const calls = setup(override);
      assert.match(outcome(await invoke()), /connection=connection_failed/u);
      assert.equal(calls.complete, 0);
      assert.equal(calls.compensations.length, 1);
      assert.equal(calls.compensations[0]?.operationKey, OPERATION);
      assert.equal(calls.compensations[0]?.brandId, BRAND);
      assert.equal(calls.compensations[0]?.installationId, INSTALLATION);
      assert.equal(Reflect.get(calls.compensations[0]?.credential ?? {}, 'access_token'), 'issued-token');
      Object.assign(dependencies, original);
    }
  });

  it('escrows a bounded credential surfaced by a failed exchange', async (t) => {
    t.mock.method(console, 'error', () => undefined);
    const issued = { access_token: 'short-meta-token', expires_in: 3_600 };
    const calls = setup({ exchange: async () => {
      throw new ConnectorExchangeError('provider', 502, 'extension failed', issued);
    } });
    assert.match(outcome(await invoke()), /connection=connection_failed/u);
    assert.equal(calls.compensations.length, 1);
    assert.deepEqual(calls.compensations[0]?.credential, {
      ...issued, acquired_at: '2026-09-08T12:00:00.000Z',
    });
    assert.equal(calls.compensations[0]?.expiresAt, '2026-09-08T13:00:00.000Z');
    assert.equal(calls.compensations[0]?.reason, 'exchange_provider_failed');
  });

  it('persists the bounded 60-day Meta expiry', async () => {
    let expiresAt: unknown;
    setup({
      isProvider: (provider: string) => provider === 'meta-business-suite',
      consumeState: async () => ({ data: [{ state_id: STATE, brand_id: BRAND, installation_id: INSTALLATION,
        cookie_binding_hash: BINDING_HASH, consume_key: OPERATION,
        requested_scopes: ['public_profile'], consume_replayed: false,
        completion_outcome: null, completed_reference_id: null,
        processing_lease_token: PROCESSING_LEASE,
        processing_lease_expires_at: '2026-09-08T12:02:00.000Z',
        processing_generation: 1, processing_acquired: true, exchange_started: false,
        redirect_uri: 'https://hq.example.test/api/connectors/meta-business-suite/callback' }], error: null }),
      exchange: async () => ({ access_token: 'long-meta-token', expires_in: 5_184_000 }),
      resolveScopes: async () => ['public_profile'],
      complete: async (_db: SupabaseClient, input: Readonly<Record<string, unknown>>) => {
        expiresAt = input.expiresAt; return INSTALLATION;
      },
    });
    assert.match(outcome(await invoke('meta-business-suite')), /connection=connected/u);
    assert.equal(expiresAt, '2026-11-07T12:00:00.000Z');
  });
});
