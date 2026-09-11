import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ConnectorCompensationError,
  queueConnectorOAuthCompensation,
} from './connector-oauth-compensation';

const REFERENCE = '11111111-1111-4111-8111-111111111111';
const INPUT = {
  brandId: '22222222-2222-4222-8222-222222222222',
  installationId: '33333333-3333-4333-8333-333333333333',
  provider: 'quickbooks-online' as const,
  actorUserId: '44444444-4444-4444-8444-444444444444',
  operationKey: '55555555-5555-4555-8555-555555555555',
  credential: { access_token: 'issued-access', refresh_token: 'issued-refresh' },
  accountLabel: 'Unverified OAuth account', grantedScopes: ['scope-1'],
  expiresAt: '2026-09-08T13:00:00.000Z', reason: 'completion_ambiguous',
  identityHint: { realmId: '12345' },
};

function database(results: readonly unknown[]) {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  let index = 0;
  const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    const result = results[Math.min(index, results.length - 1)];
    index += 1;
    if (result instanceof Error) throw result;
    return result as { data: unknown; error: unknown };
  } } as unknown as SupabaseClient;
  return { calls, db };
}

describe('connector OAuth compensation intake', () => {
  it('replays exactly the same intake after a lost response', async () => {
    const { calls, db } = database([
      new Error('response lost'),
      { data: { outcome: 'cleanup_queued', referenceId: REFERENCE }, error: null },
    ]);
    assert.deepEqual(await queueConnectorOAuthCompensation(db, INPUT), {
      outcome: 'cleanup_queued', referenceId: REFERENCE,
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[0]?.args, {
      p_brand_id: INPUT.brandId, p_installation_id: INPUT.installationId,
      p_provider_key: INPUT.provider, p_actor_user_id: INPUT.actorUserId,
      p_consume_key: INPUT.operationKey, p_cleanup_key: INPUT.operationKey,
      p_credential: INPUT.credential, p_account_label: INPUT.accountLabel,
      p_granted_scopes: ['scope-1'], p_expires_at: INPUT.expiresAt,
      p_reason: INPUT.reason, p_identity_hint: { realmId: '12345' },
    });
  });

  it('accepts reconciliation with an already connected credential', async () => {
    const { db } = database([{
      data: { outcome: 'connected', referenceId: REFERENCE }, error: null,
    }]);
    assert.equal((await queueConnectorOAuthCompensation(db, INPUT)).outcome, 'connected');
  });

  it('fails safely after malformed or rejected confirmations', async () => {
    const { db } = database([
      { data: { outcome: 'cleanup_queued', referenceId: 'invalid' }, error: null },
      { data: null, error: { message: 'private database detail' } },
    ]);
    await assert.rejects(queueConnectorOAuthCompensation(db, INPUT), (error: unknown) =>
      error instanceof ConnectorCompensationError
        && !error.message.includes('private database detail'));
  });
});
