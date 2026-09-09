import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runConnectorOAuthRefreshes,
  runConnectorOAuthRevocations,
} from './connector-oauth-maintenance';
import { revokeConnectorTokenDetailed } from './connector-oauth-revoke';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

const NOW = new Date('2026-09-08T12:00:00Z');
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const;

function row(provider: 'slack' | 'quickbooks-online') {
  return {
    job_id: IDS[0], brand_id: IDS[1], installation_id: IDS[2],
    credential_reference_id: IDS[3], provider_key: provider,
    credential_generation: 1, lease_token: IDS[4],
    credential: { access_token: 'old-access', refresh_token: 'old-refresh',
      external_account_id: 'account-1' },
    account_label: 'Account', expires_at: '2026-09-08T12:05:00Z',
    granted_scopes: ['openid'],
  };
}

function database(kind: 'refreshes' | 'revocations', provider: 'slack' | 'quickbooks-online') {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    if (name === `claim_connector_oauth_${kind}`) return { data: [row(provider)], error: null };
    return { data: true, error: null };
  } } as unknown as SupabaseClient;
  return { calls, db };
}

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth configuration recovery', { concurrency: false }, () => {
  it('backs off refresh without dialing and succeeds after configuration returns', async () => {
    configureOauthTestEnv();
    delete process.env.SLACK_CLIENT_SECRET;
    const first = database('refreshes', 'slack');
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({
      ok: true, access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3_600,
    }));
    assert.equal((await runConnectorOAuthRefreshes(first.db, NOW)).failed, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
    const failure = first.calls.find((call) => call.name === 'fail_connector_oauth_refresh');
    assert.equal(failure?.args.p_error_code, 'configuration_unavailable');
    assert.equal(failure?.args.p_retryable, true);

    process.env.SLACK_CLIENT_SECRET = 'slack-secret';
    const second = database('refreshes', 'slack');
    assert.equal((await runConnectorOAuthRefreshes(second.db, NOW)).completed, 1);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('backs off revocation without dialing and succeeds after configuration returns', async () => {
    configureOauthTestEnv();
    delete process.env.QUICKBOOKS_CLIENT_SECRET;
    const first = database('revocations', 'quickbooks-online');
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 200 }));
    assert.equal((await runConnectorOAuthRevocations(first.db, NOW)).failed, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
    const failure = first.calls.find((call) => call.name === 'fail_connector_oauth_revocation');
    assert.equal(failure?.args.p_error_code, 'configuration_unavailable');
    assert.equal(failure?.args.p_retryable, true);

    process.env.QUICKBOOKS_CLIENT_SECRET = 'quickbooks-secret';
    const second = database('revocations', 'quickbooks-online');
    assert.equal((await runConnectorOAuthRevocations(second.db, NOW)).completed, 1);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('keeps Google, YouTube, and Meta revocation independent of client secrets', async () => {
    restoreOauthTestEnv();
    mock.method(globalThis, 'fetch', async (target) => String(target).includes('/permissions')
      ? Response.json({ success: true }) : new Response(null, { status: 200 }));
    for (const provider of ['google-suite', 'youtube', 'meta-business-suite'] as const) {
      assert.equal((await revokeConnectorTokenDetailed(
        provider, { access_token: 'usable-access', external_account_id: 'account-1' },
      )).revoked, true);
    }
  });
});
