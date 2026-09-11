import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { runConnectorOAuthRefreshes } from './connector-oauth-maintenance';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

type RefreshProvider = 'google-suite' | 'quickbooks-online' | 'slack' | 'tiktok' | 'youtube';

async function runFailure(
  provider: RefreshProvider,
  failure: 'server' | 'rate_limit' | 'pre_delivery' = 'server',
) {
  configureOauthTestEnv();
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    if (failure === 'pre_delivery') {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }
    return new Response(null, { status: failure === 'rate_limit' ? 429 : 502 });
  });
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    if (name === 'claim_connector_oauth_refreshes') return { data: [{
      job_id: '11111111-1111-4111-8111-111111111111',
      brand_id: '22222222-2222-4222-8222-222222222222',
      installation_id: '33333333-3333-4333-8333-333333333333',
      credential_reference_id: '44444444-4444-4444-8444-444444444444',
      provider_key: provider, credential_generation: 1,
      lease_token: '55555555-5555-4555-8555-555555555555',
      credential: { access_token: 'old-access', refresh_token: 'old-refresh',
        external_account_id: 'connected-account' },
      account_label: 'Workspace', expires_at: '2026-09-08T12:05:00Z',
      granted_scopes: ['chat:write'],
    }], error: null };
    return { data: true, error: null };
  } } as unknown as SupabaseClient;

  assert.equal((await runConnectorOAuthRefreshes(
    db, new Date('2026-09-08T12:00:00Z'),
  )).failed, 1);
  const failed = calls.find((call) => call.name === 'fail_connector_oauth_refresh');
  return { failed, fetchCalls: fetchMock.mock.callCount() };
}

it('defers reusable-provider 5xx to the leased SQL backoff', async () => {
  const { failed, fetchCalls } = await runFailure('youtube');
  assert.equal(fetchCalls, 1);
  assert.equal(failed?.args.p_error_code, 'provider_rejected');
  assert.equal(failed?.args.p_retryable, true);
});

it('never replays a rotating token after an ambiguous 5xx', async () => {
  const { failed, fetchCalls } = await runFailure('slack');
  assert.equal(fetchCalls, 2, 'Slack uses only its one immediate grace retry');
  assert.equal(failed?.args.p_error_code, 'rotation_ambiguous');
  assert.equal(failed?.args.p_retryable, false);
  mock.restoreAll();
  const tiktok = await runFailure('tiktok');
  assert.equal(tiktok.fetchCalls, 1, 'TikTok has no documented old-token grace');
  assert.equal(tiktok.failed?.args.p_error_code, 'rotation_ambiguous');
  assert.equal(tiktok.failed?.args.p_retryable, false);
});

it('durably retries explicit rate limits without unsafe TikTok replay', async () => {
  let result = await runFailure('slack', 'rate_limit');
  assert.equal(result.fetchCalls, 2);
  assert.equal(result.failed?.args.p_error_code, 'provider_rejected');
  assert.equal(result.failed?.args.p_retryable, true);
  mock.restoreAll();
  result = await runFailure('tiktok', 'rate_limit');
  assert.equal(result.fetchCalls, 1);
  assert.equal(result.failed?.args.p_error_code, 'provider_rejected');
  assert.equal(result.failed?.args.p_retryable, true);
});

it('durably retries provable pre-delivery failures by provider policy', async () => {
  let result = await runFailure('slack', 'pre_delivery');
  assert.equal(result.fetchCalls, 2);
  assert.equal(result.failed?.args.p_error_code, 'transport');
  assert.equal(result.failed?.args.p_retryable, true);
  mock.restoreAll();
  result = await runFailure('tiktok', 'pre_delivery');
  assert.equal(result.fetchCalls, 1);
  assert.equal(result.failed?.args.p_error_code, 'transport');
  assert.equal(result.failed?.args.p_retryable, true);
});

it('defers Google and QuickBooks transient responses to SQL backoff', async () => {
  for (const provider of ['google-suite', 'quickbooks-online'] as const) {
    const result = await runFailure(provider);
    assert.equal(result.fetchCalls, 1);
    assert.equal(result.failed?.args.p_error_code, 'provider_rejected');
    assert.equal(result.failed?.args.p_retryable, true);
    mock.restoreAll();
  }
});
