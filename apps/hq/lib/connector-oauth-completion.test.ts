import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  completeConnectorOAuth,
  ConnectorCompletionError,
} from './connector-oauth-completion';

const input = {
  brandId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222', provider: 'slack' as const,
  actorUserId: '33333333-3333-4333-8333-333333333333',
  completionKey: '44444444-4444-4444-8444-444444444444',
  credential: { access_token: 'newly-issued', refresh_token: 'refresh-issued',
    external_account_id: 'workspace', acquired_at: '2026-09-08T12:00:00Z' },
  accountId: 'workspace', accountLabel: 'Workspace', grantedScopes: ['chat:write'],
  expiresAt: '2026-09-08T13:00:00Z',
};
const referenceId = '6f536457-0793-4e80-8092-59a336e668d5';

type Call = { name: string; args: Readonly<Record<string, unknown>> };

function database(handler: (name: string, calls: readonly Call[]) => unknown) {
  const calls: Call[] = [];
  const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    return handler(name, calls);
  } } as unknown as SupabaseClient;
  return { calls, db };
}

describe('completeConnectorOAuth', () => {
  it('leaves rejected-token cleanup with the durable SQL owner', async () => {
    for (const code of [
      'connector_oauth_completion_conflict_safe_revoke',
      'connector_oauth_completion_conflict_shared_grant',
      'connector_oauth_capability_unavailable',
    ]) {
      const { calls, db } = database((name) => name === 'complete_connector_oauth_connection'
        ? { data: null, error: { code: '22023', message: code } }
        : { data: { outcome: 'cleanup_queued', referenceId }, error: null });
      await assert.rejects(completeConnectorOAuth(db, input), (error: unknown) =>
        error instanceof ConnectorCompletionError && error.cleanup === 'queued'
          && error.contractCode === code);
      assert.deepEqual(calls.map((call) => call.name), [
        'complete_connector_oauth_connection', 'queue_connector_oauth_compensation',
      ]);
      assert.equal(calls[1]?.args.p_consume_key, input.completionKey);
      assert.equal(calls[1]?.args.p_cleanup_key, input.completionKey);
      assert.equal(calls[1]?.args.p_credential, input.credential);
    }
  });

  it('accepts SQL confirmation that rejection was already staged', async () => {
    const { calls, db } = database(() => ({ data: null, error: null }));
    await assert.rejects(completeConnectorOAuth(db, input), (error: unknown) =>
      error instanceof ConnectorCompletionError && error.cleanup === 'queued');
    assert.equal(calls.length, 1);
  });

  it('returns an accepted reference without queuing cleanup', async () => {
    const { calls, db } = database(() => ({ data: referenceId, error: null }));
    assert.equal(await completeConnectorOAuth(db, input), referenceId);
    assert.equal(calls.length, 1);
  });

  it('reuses one completion key when a response is lost', async () => {
    const { calls, db } = database((_name, seen) => {
      if (seen.length === 1) throw new Error('response lost');
      return { data: referenceId, error: null };
    });
    assert.equal(await completeConnectorOAuth(db, input), referenceId);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.args.p_completion_key === input.completionKey));
  });

  it('reconciles an ambiguous completion through stable durable intake', async () => {
    const { calls, db } = database((name) => {
      if (name === 'complete_connector_oauth_connection') throw new Error('response lost');
      return { data: { outcome: 'connected', referenceId }, error: null };
    });
    assert.equal(await completeConnectorOAuth(db, input), referenceId);
    assert.deepEqual(calls.map((call) => call.name), [
      'complete_connector_oauth_connection', 'complete_connector_oauth_connection',
      'queue_connector_oauth_compensation',
    ]);
  });

  it('preserves the QuickBooks identity hint while reconciling a lost completion', async () => {
    const qboInput = {
      ...input, provider: 'quickbooks-online' as const, identityHint: { realmId: '12345' },
    };
    const { calls, db } = database((name) => {
      if (name === 'complete_connector_oauth_connection') throw new Error('response lost');
      return { data: { outcome: 'connected', referenceId }, error: null };
    });
    assert.equal(await completeConnectorOAuth(db, qboInput), referenceId);
    const queued = calls.find((call) => call.name === 'queue_connector_oauth_compensation');
    assert.deepEqual(queued?.args.p_identity_hint, { realmId: '12345' });
    assert.equal(queued?.args.p_consume_key, input.completionKey);
  });

  it('reports ambiguous cleanup after both stable intake attempts fail', async () => {
    const { calls, db } = database(() => { throw new Error('response lost'); });
    await assert.rejects(completeConnectorOAuth(db, input), (error: unknown) => {
      assert.ok(error instanceof ConnectorCompletionError);
      assert.equal(error.cleanup, 'ambiguous');
      assert.equal(error.outcome, 'ambiguous');
      assert.ok(!error.message.includes('newly-issued'));
      return true;
    });
    assert.equal(calls.length, 4);
    assert.ok(calls.slice(2).every((call) => call.args.p_reason === 'completion_ambiguous'));
  });
});
