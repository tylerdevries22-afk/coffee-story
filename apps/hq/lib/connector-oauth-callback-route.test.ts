import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ConnectorCompletionError } from './connector-oauth-completion';

type Dependencies = typeof import('./connector-oauth-callback-dependencies')['connectorOAuthCallbackDependencies'];
type CallbackGet = typeof import('../app/api/connectors/[provider]/callback/route')['GET'];
let dependencies: Dependencies;
let callbackGet: CallbackGet;
let original: Dependencies;
const BRAND_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_KEY = '33333333-3333-4333-8333-333333333333';
const REFERENCE_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';
const STATE_ID = '66666666-6666-4666-8666-666666666666';
const PROCESSING_LEASE = '77777777-7777-4777-8777-777777777777';
const EXCHANGE_ATTEMPT = '88888888-8888-4888-8888-888888888888';
const NOW = new Date('2026-09-08T12:00:00.000Z');
const STATE_HASH = 'a'.repeat(64);
const BINDING_HASH = 'b'.repeat(64);

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

type Calls = {
  authorize: number;
  compensations: Readonly<Record<string, unknown>>[];
  consumeArgs: Readonly<Record<string, unknown>>[];
  completions: Readonly<Record<string, unknown>>[];
  exchanges: number;
  starts: Readonly<Record<string, unknown>>[];
};

function setup(overrides: Readonly<Record<string, unknown>> = {}): Calls {
  const calls: Calls = {
    authorize: 0, compensations: [], consumeArgs: [], completions: [], exchanges: 0, starts: [],
  };
  const db = {} as SupabaseClient;
  Object.assign(dependencies, {
    authorize: async () => {
      calls.authorize += 1;
      return { brandId: BRAND_ID, db, userId: USER_ID };
    },
    callbackUrl: () => 'https://hq.example.test/api/connectors/slack/callback',
    compensate: async (_db: SupabaseClient, input: Readonly<Record<string, unknown>>) => {
      calls.compensations.push(input);
      return { outcome: 'cleanup_queued' as const, referenceId: REFERENCE_ID };
    },
    complete: async (_db: SupabaseClient, input: Readonly<Record<string, unknown>>) => {
      calls.completions.push(input);
      return REFERENCE_ID;
    },
    consumeState: async (_db: SupabaseClient, args: Readonly<Record<string, unknown>>) => {
      calls.consumeArgs.push(args);
      return { data: [{
        state_id: STATE_ID, brand_id: BRAND_ID, installation_id: INSTALLATION_ID,
        cookie_binding_hash: BINDING_HASH, consume_key: OPERATION_KEY,
        requested_scopes: ['channels:read', 'chat:write'], consume_replayed: false,
        completion_outcome: null, completed_reference_id: null,
        processing_lease_token: PROCESSING_LEASE,
        processing_lease_expires_at: '2026-09-08T12:02:00.000Z',
        processing_generation: 1, processing_acquired: true, exchange_started: false,
        redirect_uri: 'https://hq.example.test/api/connectors/slack/callback',
      }], error: null };
    },
    cookieName: (_provider: string, nonce: string) => `oauth-cookie-${nonce}`,
    exchange: async () => {
      calls.exchanges += 1;
      return { access_token: 'issued-token', refresh_token: 'refresh-token',
        expires_in: 3_600, scope: 'channels:read,chat:write' };
    },
    hasGrant: () => true,
    identity: async () => ({ accountId: 'workspace-1', accountLabel: 'Workspace' }),
    isProvider: (candidate: string) => candidate === 'slack',
    newOperationKey: () => EXCHANGE_ATTEMPT,
    now: () => NOW,
    parseCookie: () => ({ binding: 'cookie-binding-value-that-is-long-enough',
      operationKey: OPERATION_KEY, verifier: 'v'.repeat(43) }),
    providerReady: () => true,
    resolveScopes: async () => ['channels:read', 'chat:write'],
    sha256: (value: string) => value === 'state-nonce' ? STATE_HASH : BINDING_HASH,
    startExchange: async (_db: SupabaseClient, args: Readonly<Record<string, unknown>>) => {
      calls.starts.push(args); return true;
    },
    verifyState: () => ({ nonce: 'state-nonce' }),
    ...overrides,
  });
  return calls;
}

function request(query = 'state=signed&code=code') {
  return new Request(`https://hq.example.test/api/connectors/slack/callback?${query}`);
}

async function invoke(provider = 'slack', query?: string): Promise<Response> {
  return callbackGet(request(query), { params: Promise.resolve({ provider }) });
}

function location(response: Response): string { return response.headers.get('location') ?? ''; }

describe('connector OAuth callback GET', { concurrency: false }, () => {
  it('binds consume and completion to one stable operation key', async () => {
    const calls = setup();
    const response = await invoke();
    assert.match(location(response), /connection=connected/u);
    assert.match(response.headers.get('set-cookie') ?? '', /oauth-cookie-state-nonce=;/u);
    assert.deepEqual(calls.consumeArgs, [{
      p_provider_key: 'slack', p_actor_user_id: USER_ID,
      p_state_hash: STATE_HASH, p_cookie_binding_hash: BINDING_HASH,
      p_consume_key: OPERATION_KEY,
    }]);
    assert.deepEqual(calls.starts, [{
      p_state_id: STATE_ID, p_consume_key: OPERATION_KEY,
      p_processing_lease_token: PROCESSING_LEASE,
      p_exchange_attempt_key: EXCHANGE_ATTEMPT, p_now: NOW.toISOString(),
    }]);
    assert.deepEqual(calls.completions, [{
      brandId: BRAND_ID, installationId: INSTALLATION_ID, provider: 'slack',
      actorUserId: USER_ID, completionKey: OPERATION_KEY,
      credential: { access_token: 'issued-token', refresh_token: 'refresh-token',
        expires_in: 3_600, scope: 'channels:read,chat:write',
        external_account_id: 'workspace-1', acquired_at: NOW.toISOString() },
      accountId: 'workspace-1', accountLabel: 'Workspace',
      grantedScopes: ['channels:read', 'chat:write'],
      expiresAt: '2026-09-08T13:00:00.000Z',
      identityHint: {},
    }]);
  });

  it('classifies ambiguous storage and failed safe cleanup without route revocation', async (t) => {
    const logged: string[] = [];
    t.mock.method(console, 'error', (message: string) => { logged.push(message); });
    for (const [cleanup, stage] of [['not_required', 'storage'], ['ambiguous', 'cleanup']] as const) {
      const calls = setup({ complete: async () => {
        throw new ConnectorCompletionError(cleanup, 'ambiguous');
      } });
      assert.match(location(await invoke()), /connection=connection_failed/u);
      assert.equal(logged.pop(), `connector.oauth.callback provider=slack stage=${stage}`);
      if (cleanup === 'ambiguous') {
        assert.equal(calls.compensations[0]?.reason, 'completion_ambiguous');
      }
      Object.assign(dependencies, original);
    }
  });

  it('never exchanges an authorization code again after a consume replay', async () => {
    for (const [completion_outcome, status, connection] of [
      ['connected', 302, 'connected'], ['cleanup_queued', 302, 'connection_failed'],
      [null, 409, null],
    ] as const) {
      const calls = setup({ consumeState: async () => ({ data: [{
        state_id: STATE_ID, brand_id: BRAND_ID, installation_id: INSTALLATION_ID,
        cookie_binding_hash: BINDING_HASH, consume_key: OPERATION_KEY,
        requested_scopes: ['channels:read'], consume_replayed: true,
        completion_outcome, completed_reference_id: completion_outcome ? REFERENCE_ID : null,
        processing_lease_token: completion_outcome ? null : PROCESSING_LEASE,
        processing_lease_expires_at: completion_outcome ? null : '2026-09-08T12:02:00.000Z',
        processing_generation: 1, processing_acquired: completion_outcome ? false : true,
        exchange_started: completion_outcome ? false : true,
        redirect_uri: 'https://hq.example.test/api/connectors/slack/callback',
      }], error: null }) });
      const response = await invoke();
      assert.equal(response.status, status);
      if (connection) assert.match(location(response), new RegExp(`connection=${connection}`));
      else assert.equal(response.headers.get('retry-after'), '2');
      assert.equal(calls.exchanges, 0);
      assert.equal(calls.starts.length, 0);
      assert.equal(calls.completions.length, 0);
      Object.assign(dependencies, original);
    }
  });

  it('rejects unknown providers and oversized codes before authorization', async () => {
    const calls = setup();
    assert.equal((await invoke('unknown')).status, 404);
    assert.match(location(await invoke('slack', `state=signed&code=${'x'.repeat(8_193)}`)), /invalid_state/u);
    assert.equal(calls.authorize, 0);
    assert.equal(calls.exchanges, 0);
  });
});
