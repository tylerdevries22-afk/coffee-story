import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, before, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ConnectorIdentityError } from './connector-oauth-identity';

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

function setup() {
  const compensations: Readonly<Record<string, unknown>>[] = [];
  let consumes = 0;
  let exchanges = 0;
  const db = {} as SupabaseClient;
  Object.assign(dependencies, {
    authorize: async () => ({ brandId: IDS.brand, db, userId: IDS.user }),
    callbackUrl: () => 'https://hq.example.test/api/connectors/quickbooks-online/callback',
    compensate: async (_db: SupabaseClient, input: Readonly<Record<string, unknown>>) => {
      compensations.push(input);
      return { outcome: 'cleanup_queued' as const, referenceId: IDS.reference };
    },
    consumeState: async () => {
      consumes += 1;
      return { data: [{
        state_id: IDS.state, brand_id: IDS.brand, installation_id: IDS.installation,
        cookie_binding_hash: 'b'.repeat(64), consume_key: IDS.operation,
        requested_scopes: ['com.intuit.quickbooks.accounting'], consume_replayed: false,
        completion_outcome: null, completed_reference_id: null,
        processing_lease_token: IDS.lease,
        processing_lease_expires_at: '2026-09-08T12:02:00.000Z',
        processing_generation: 1, processing_acquired: true, exchange_started: false,
        redirect_uri: 'https://hq.example.test/api/connectors/quickbooks-online/callback',
      }], error: null };
    },
    cookieName: () => 'oauth-qbo',
    exchange: async () => {
      exchanges += 1;
      return { access_token: 'issued-access', refresh_token: 'issued-refresh', expires_in: 3_600 };
    },
    identity: async () => { throw new ConnectorIdentityError(); },
    isProvider: (provider: string) => provider === 'quickbooks-online',
    newOperationKey: () => IDS.attempt,
    now: () => new Date('2026-09-08T12:00:00Z'),
    parseCookie: () => ({ binding: 'bounded-cookie-binding', operationKey: IDS.operation,
      verifier: 'v'.repeat(43) }),
    sha256: () => 'b'.repeat(64),
    startExchange: async () => true,
    verifyState: () => ({ nonce: 'nonce' }),
  });
  return { compensations, get consumes() { return consumes; }, get exchanges() { return exchanges; } };
}

function invoke(realmId: string) {
  const url = new URL('https://hq.example.test/api/connectors/quickbooks-online/callback');
  url.searchParams.set('state', 'signed');
  url.searchParams.set('code', 'code');
  url.searchParams.set('realmId', realmId);
  return callbackGet(new Request(url), {
    params: Promise.resolve({ provider: 'quickbooks-online' }),
  });
}

it('binds the QuickBooks realm to durable cleanup and rejects malformed realms before consume', async (t) => {
  t.mock.method(console, 'error', () => undefined);
  const calls = setup();
  assert.match((await invoke('12345')).headers.get('location') ?? '', /connection_failed/u);
  assert.equal(calls.exchanges, 1);
  assert.deepEqual(calls.compensations[0]?.identityHint, { realmId: '12345' });
  assert.equal(calls.compensations[0]?.operationKey, IDS.operation);
  const before = calls.consumes;
  assert.match((await invoke('bad;realm')).headers.get('location') ?? '', /invalid_state/u);
  assert.equal(calls.consumes, before);
  assert.equal(calls.exchanges, 1);
});
