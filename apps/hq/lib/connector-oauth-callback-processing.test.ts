import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

type Dependencies = typeof import('./connector-oauth-callback-dependencies')['connectorOAuthCallbackDependencies'];
type CallbackGet = typeof import('../app/api/connectors/[provider]/callback/route')['GET'];
let dependencies: Dependencies;
let callbackGet: CallbackGet;
let original: Dependencies;
const IDS = {
  state: '11111111-1111-4111-8111-111111111111',
  brand: '22222222-2222-4222-8222-222222222222',
  installation: '33333333-3333-4333-8333-333333333333',
  operation: '44444444-4444-4444-8444-444444444444',
  user: '55555555-5555-4555-8555-555555555555',
  reference: '66666666-6666-4666-8666-666666666666',
  lease: '77777777-7777-4777-8777-777777777777',
  attempt: '88888888-8888-4888-8888-888888888888',
};

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

function setup(exchangeStarted: boolean, start: () => Promise<boolean>) {
  let exchanges = 0;
  let starts = 0;
  const db = {} as SupabaseClient;
  Object.assign(dependencies, {
    authorize: async () => ({ brandId: IDS.brand, db, userId: IDS.user }),
    callbackUrl: () => 'https://hq.example.test/api/connectors/slack/callback',
    complete: async () => IDS.reference,
    consumeState: async () => ({ data: [{
      state_id: IDS.state, brand_id: IDS.brand, installation_id: IDS.installation,
      cookie_binding_hash: 'b'.repeat(64), consume_key: IDS.operation,
      requested_scopes: ['chat:write'], redirect_uri:
        'https://hq.example.test/api/connectors/slack/callback',
      consume_replayed: true, completion_outcome: null, completed_reference_id: null,
      processing_lease_token: IDS.lease,
      processing_lease_expires_at: '2026-09-08T12:02:00.000Z',
      processing_generation: 2, processing_acquired: !exchangeStarted, exchange_started: exchangeStarted,
    }], error: null }),
    cookieName: () => 'oauth-state',
    exchange: async () => {
      exchanges += 1;
      return { access_token: 'issued-access', refresh_token: 'issued-refresh',
        expires_in: 3_600, scope: 'chat:write' };
    },
    hasGrant: () => true,
    identity: async () => ({ accountId: 'T1', accountLabel: 'Workspace' }),
    isProvider: (provider: string) => provider === 'slack',
    newOperationKey: () => IDS.attempt,
    now: () => new Date('2026-09-08T12:00:00.000Z'),
    parseCookie: () => ({ binding: 'bounded-binding', operationKey: IDS.operation,
      verifier: 'v'.repeat(43) }),
    providerReady: () => true,
    resolveScopes: async () => ['chat:write'],
    sha256: (value: string) => value === 'nonce' ? 'a'.repeat(64) : 'b'.repeat(64),
    startExchange: async () => { starts += 1; return start(); },
    verifyState: () => ({ nonce: 'nonce' }),
  });
  return { get exchanges() { return exchanges; }, get starts() { return starts; } };
}

function invoke() {
  return callbackGet(new Request(
    'https://hq.example.test/api/connectors/slack/callback?state=signed&code=code',
  ), { params: Promise.resolve({ provider: 'slack' }) });
}

describe('connector OAuth callback processing lease', { concurrency: false }, () => {
  it('resumes an unstarted consume replay under a new exchange attempt', async () => {
    const calls = setup(false, async () => true);
    assert.match((await invoke()).headers.get('location') ?? '', /connection=connected/u);
    assert.equal(calls.starts, 1);
    assert.equal(calls.exchanges, 1);
  });

  it('does not replay a code after another attempt recorded the exchange', async () => {
    const calls = setup(true, async () => true);
    const response = await invoke();
    assert.equal(response.status, 409);
    assert.equal(calls.starts, 0);
    assert.equal(calls.exchanges, 0);
  });

  it('does not exchange after a stale or unconfirmed start marker', async (t) => {
    t.mock.method(console, 'error', () => undefined);
    let calls = setup(false, async () => false);
    assert.equal((await invoke()).status, 409);
    assert.equal(calls.exchanges, 0);
    Object.assign(dependencies, original);
    calls = setup(false, async () => { throw new Error('private database detail'); });
    assert.match((await invoke()).headers.get('location') ?? '', /connection=connection_failed/u);
    assert.equal(calls.exchanges, 0);
  });

  it('replays one stable start RPC after its first response is lost', async () => {
    const calls: Readonly<Record<string, unknown>>[] = [];
    let count = 0;
    const db = { rpc: async (_name: string, args: Readonly<Record<string, unknown>>) => {
      calls.push(args);
      count += 1;
      if (count === 1) throw new Error('response lost');
      return { data: true, error: null };
    } } as unknown as SupabaseClient;
    const args = { p_state_id: IDS.state, p_consume_key: IDS.operation,
      p_processing_lease_token: IDS.lease, p_exchange_attempt_key: IDS.attempt,
      p_now: '2026-09-08T12:00:00.000Z' };
    assert.equal(await original.startExchange(db, args), true);
    assert.deepEqual(calls, [args, args]);
  });

  it('cancels a fully ambiguous start before retrying provider ownership', async () => {
    const names: string[] = [];
    let starts = 0;
    const db = { rpc: async (name: string) => {
      names.push(name);
      if (name === 'start_connector_oauth_code_exchange') {
        starts += 1;
        if (starts <= 2) throw new Error('response lost');
      }
      return { data: true, error: null };
    } } as unknown as SupabaseClient;
    assert.equal(await original.startExchange(db, {
      p_state_id: IDS.state, p_consume_key: IDS.operation,
      p_processing_lease_token: IDS.lease, p_exchange_attempt_key: IDS.attempt,
      p_now: '2026-09-08T12:00:00.000Z',
    }), true);
    assert.deepEqual(names, [
      'start_connector_oauth_code_exchange', 'start_connector_oauth_code_exchange',
      'cancel_connector_oauth_code_exchange', 'start_connector_oauth_code_exchange',
    ]);
  });
});
