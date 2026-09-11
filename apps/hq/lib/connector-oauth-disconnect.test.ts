import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ConnectorDisconnectError,
  disconnectConnectorOAuth,
  sameOriginConnectorMutation,
} from './connector-oauth-disconnect';

const input = { brandId: 'brand', providerKey: 'slack', actorUserId: 'owner' };

describe('disconnectConnectorOAuth', () => {
  it('rejects missing and cross-origin mutations before running the write', async () => {
    let calls = 0;
    const run = async () => { calls += 1; return Response.json({ ok: true }); };
    for (const request of [
      new Request('https://hq.example.test/api/connectors/slack/authorize', { method: 'DELETE' }),
      new Request('https://hq.example.test/api/connectors/slack/authorize', {
        method: 'DELETE', headers: { origin: 'https://attacker.example' },
      }),
    ]) {
      assert.equal((await sameOriginConnectorMutation(request, run)).status, 403);
    }
    assert.equal(calls, 0);
  });

  it('admits an exact same-origin mutation', async () => {
    const request = new Request('https://hq.example.test/api/connectors/slack/authorize', {
      method: 'DELETE', headers: { origin: 'https://hq.example.test' },
    });
    assert.equal((await sameOriginConnectorMutation(
      request, async () => Response.json({ ok: true }),
    )).status, 200);
  });

  it('passes the tenant, provider, and actor to the service-only RPC', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: true, error: null };
    } } as unknown as SupabaseClient;

    await disconnectConnectorOAuth(db, input);

    assert.deepEqual(calls, [{
      name: 'disconnect_connector_oauth_connection',
      args: { p_brand_id: 'brand', p_provider_key: 'slack', p_actor_user_id: 'owner' },
    }]);
  });

  it('fails closed on a rejected or non-affirmative teardown', async () => {
    for (const result of [{ data: false, error: null }, { data: null, error: { message: 'failed' } }]) {
      const db = { rpc: async () => result } as unknown as SupabaseClient;
      await assert.rejects(
        disconnectConnectorOAuth(db, input),
        (error: unknown) => error instanceof ConnectorDisconnectError,
      );
    }
  });
});
