import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runConnectorOAuthRefreshes,
  runConnectorOAuthRevocations,
} from './connector-oauth-maintenance';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

const IDS = {
  job: '11111111-1111-4111-8111-111111111111',
  brand: '22222222-2222-4222-8222-222222222222',
  installation: '33333333-3333-4333-8333-333333333333',
  reference: '44444444-4444-4444-8444-444444444444',
  lease: '55555555-5555-4555-8555-555555555555',
};
const NOW = new Date('2026-09-08T12:00:00Z');

function row(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    job_id: IDS.job, brand_id: IDS.brand, installation_id: IDS.installation,
    credential_reference_id: IDS.reference, provider_key: 'youtube',
    credential_generation: 1, lease_token: IDS.lease,
    credential: { access_token: 'old-access', refresh_token: 'old-refresh',
      external_account_id: 'account-1' },
    account_label: 'Account', expires_at: '2026-09-08T12:05:00Z',
    granted_scopes: ['openid'], ...overrides,
  };
}

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth claimed-job boundaries', { concurrency: false }, () => {
  it('quarantines one poisoned row while a valid co-batched refresh settles', async () => {
    configureOauthTestEnv();
    const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
    const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
      calls.push({ name, args });
      if (name === 'claim_connector_oauth_refreshes') return { data: [
        row({ credential: { access_token: 'old-access', refresh_token: 'old-refresh' } }),
        row({ job_id: '66666666-6666-4666-8666-666666666666' }),
      ], error: null };
      return { data: true, error: null };
    } } as unknown as SupabaseClient;
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({
      access_token: 'new-access', expires_in: 3_600,
    }));

    assert.deepEqual(await runConnectorOAuthRefreshes(db, NOW), {
      claimed: 2, completed: 1, failed: 1, stale: 0,
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(calls.filter((call) => call.name === 'fail_connector_oauth_refresh').length, 1);
    assert.equal(calls.filter((call) => call.name === 'complete_connector_oauth_refresh').length, 1);
  });

  it('drops an unusable optional refresh token before access-token revocation', async () => {
    const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
    const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
      calls.push({ name, args });
      if (name === 'claim_connector_oauth_revocations') return { data: [row({
        provider_key: 'google-suite',
        credential: { access_token: 'usable-access', refresh_token: 'short',
          external_account_id: 'account-1' },
      })], error: null };
      return { data: true, error: null };
    } } as unknown as SupabaseClient;
    let presented = '';
    mock.method(globalThis, 'fetch', async (_target, init) => {
      presented = String(init?.body);
      return new Response(null, { status: 200 });
    });

    assert.equal((await runConnectorOAuthRevocations(db, NOW)).completed, 1);
    assert.equal(new URLSearchParams(presented).get('token'), 'usable-access');
    assert.equal(calls.some((call) => call.name === 'fail_connector_oauth_revocation'), false);
  });

  it('allows identity-less QuickBooks credentials through credential-scoped revocation', async () => {
    configureOauthTestEnv();
    const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
    const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
      calls.push({ name, args });
      if (name === 'claim_connector_oauth_revocations') return { data: [row({
        provider_key: 'quickbooks-online',
        credential: { access_token: 'usable-access', refresh_token: 'usable-refresh' },
      })], error: null };
      return { data: true, error: null };
    } } as unknown as SupabaseClient;
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      new Response(null, { status: 200 }));

    assert.equal((await runConnectorOAuthRevocations(db, NOW)).completed, 1);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(calls.some((call) => call.name === 'fail_connector_oauth_revocation'), false);
  });
});
