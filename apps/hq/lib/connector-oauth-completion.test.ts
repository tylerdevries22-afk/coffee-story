import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  completeConnectorOAuth,
  ConnectorCompletionError,
} from './connector-oauth-completion';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

const input = {
  brandId: 'brand', installationId: 'installation', provider: 'slack' as const,
  actorUserId: 'owner', credential: { access_token: 'newly-issued', acquired_at: 'now' },
  accountId: 'workspace', accountLabel: 'Workspace', grantedScopes: ['chat:write'],
  expiresAt: null,
};

describe('completeConnectorOAuth', { concurrency: false }, () => {
  it('revokes the issued token when supersession rejects completion', async () => {
    configureOauthTestEnv();
    const rpcCalls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { data: null, error: { message: 'connector_oauth_state_incomplete' } };
    } } as unknown as SupabaseClient;
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: true, revoked: true }));

    await assert.rejects(
      completeConnectorOAuth(db, input),
      (error: unknown) => error instanceof ConnectorCompletionError && error.cleanupSucceeded,
    );
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(rpcCalls.length, 1, 'the credential is offered to one atomic completion only');
    assert.equal(Reflect.get(Reflect.get(rpcCalls[0]!, 'args'), 'p_credential'), input.credential);
  });

  it('does not revoke a credential the database accepted', async () => {
    configureOauthTestEnv();
    const db = { rpc: async () => ({ data: 'credential-reference', error: null }) } as unknown as SupabaseClient;
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: true, revoked: true }));
    assert.equal(await completeConnectorOAuth(db, input), 'credential-reference');
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('surfaces a safe cleanup state when both completion and revocation fail', async () => {
    configureOauthTestEnv();
    const db = { rpc: async () => { throw new Error('database unavailable'); } } as unknown as SupabaseClient;
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
    await assert.rejects(
      completeConnectorOAuth(db, input),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorCompletionError);
        assert.equal(error.cleanupSucceeded, false);
        assert.ok(!error.message.includes('newly-issued'));
        return true;
      },
    );
    assert.equal(fetchMock.mock.callCount(), 2);
  });
});
