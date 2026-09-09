import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, before, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

type Dependencies = typeof import('./connector-oauth-authorize-dependencies')['connectorOAuthAuthorizeDependencies'];
type AuthorizeGet = typeof import('../app/api/connectors/[provider]/authorize/route')['GET'];
let dependencies: Dependencies;
let authorizeGet: AuthorizeGet;
let original: Dependencies;

const BRAND = '11111111-1111-4111-8111-111111111111';
const INSTALLATION = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OPERATION = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-08T12:00:00.000Z');

before(async () => {
  registerHooks({ resolve(specifier, context, nextResolve) {
    return specifier === 'server-only'
      ? nextResolve(specifier, { ...context, conditions: [...context.conditions, 'react-server'] })
      : nextResolve(specifier, context);
  } });
  ({ connectorOAuthAuthorizeDependencies: dependencies } = await import('./connector-oauth-authorize-dependencies'));
  ({ GET: authorizeGet } = await import('../app/api/connectors/[provider]/authorize/route'));
  original = { ...dependencies };
});

afterEach(() => {
  Object.assign(dependencies, original);
  mock.restoreAll();
});

function setup(begin: () => unknown) {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const db = {} as SupabaseClient;
  Object.assign(dependencies, {
    authorizationUrl: () => 'https://provider.example.test/authorize',
    authorize: async () => ({ brandId: BRAND, db, userId: USER }),
    beginState: async (_db: SupabaseClient, args: Readonly<Record<string, unknown>>) => {
      calls.push(args);
      return begin();
    },
    callbackUrl: () => 'https://hq.example.test/api/connectors/slack/callback',
    cookieName: (_provider: string, nonce: string) => `oauth-${nonce}`,
    createMaterial: () => ({
      codeChallenge: 'challenge', codeVerifier: 'v'.repeat(43),
      cookieBinding: 'binding-value-that-is-long-enough',
      cookieBindingSha256: 'b'.repeat(64), nonce: 'nonce-a', nonceSha256: 'a'.repeat(64),
      state: 'signed-state',
    }),
    isProvider: (candidate: string) => candidate === 'slack',
    now: () => NOW,
    providerReady: () => true,
    randomUuid: () => OPERATION,
    scopes: () => ['channels:read'],
    stateSecret: () => 'state-secret-that-is-long-enough',
  });
  return calls;
}

function invoke(provider = 'slack') {
  return authorizeGet(
    new Request(`https://hq.example.test/api/connectors/${provider}/authorize`),
    { params: Promise.resolve({ provider }) },
  );
}

describe('connector OAuth authorize GET', { concurrency: false }, () => {
  it('redirects only after SQL confirms authorization readiness', async () => {
    const calls = setup(() => ({
      data: { status: 'authorization_ready', installationId: INSTALLATION }, error: null,
    }));
    const response = await invoke();
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://provider.example.test/authorize');
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^oauth-nonce-a=/u);
    const encoded = cookie.match(/^oauth-nonce-a=([^;]+)/u)?.[1] ?? '';
    assert.deepEqual(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')), {
      binding: 'binding-value-that-is-long-enough', operationKey: OPERATION,
      verifier: 'v'.repeat(43),
    });
    assert.deepEqual(calls, [{
      p_brand_id: BRAND, p_provider_key: 'slack', p_actor_user_id: USER,
      p_state_hash: 'a'.repeat(64), p_cookie_binding_hash: 'b'.repeat(64),
      p_requested_scopes: ['channels:read'],
      p_redirect_uri: 'https://hq.example.test/api/connectors/slack/callback',
      p_expires_at: '2026-09-08T12:10:00.000Z',
    }]);
  });

  it('does not redirect or set a cookie while prior revocation is pending', async () => {
    setup(() => ({
      data: { status: 'revocation_pending', installationId: INSTALLATION }, error: null,
    }));
    const response = await invoke();
    assert.equal(response.status, 409);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.match(await response.text(), /still being revoked/u);
  });

  it('fails safely for malformed, returned-error, and thrown begin outcomes', async () => {
    for (const begin of [
      () => ({ data: { status: 'authorization_ready', installationId: 'bad' }, error: null }),
      () => ({ data: null, error: { message: 'private database detail' } }),
      () => { throw new Error('private transport detail'); },
    ]) {
      setup(begin);
      const response = await invoke();
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.ok(!(await response.text()).includes('private'));
      Object.assign(dependencies, original);
    }
  });
});
