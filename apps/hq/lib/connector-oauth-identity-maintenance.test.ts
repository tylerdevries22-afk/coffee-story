import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { runConnectorOAuthIdentities } from './connector-oauth-identity-maintenance';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const IDS = {
  job: '11111111-1111-4111-8111-111111111111',
  brand: '22222222-2222-4222-8222-222222222222',
  installation: '33333333-3333-4333-8333-333333333333',
  reference: '44444444-4444-4444-8444-444444444444',
  lease: '55555555-5555-4555-8555-555555555555',
};

function row(provider = 'meta-business-suite', overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    job_id: IDS.job, brand_id: IDS.brand, installation_id: IDS.installation,
    credential_reference_id: IDS.reference, provider_key: provider,
    credential_generation: 1, lease_token: IDS.lease,
    credential: { access_token: 'issued-access' }, account_label: 'Pending',
    expires_at: null, granted_scopes: [], identity_hint: {}, ...overrides,
  };
}

function database(claimed: readonly unknown[]) {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    return name === 'claim_connector_oauth_identities'
      ? { data: claimed, error: null } : { data: true, error: null };
  } } as unknown as SupabaseClient;
  return { calls, db };
}

afterEach(() => mock.restoreAll());

describe('connector OAuth identity maintenance', { concurrency: false }, () => {
  it('claims and CAS-completes an identified cleanup credential', async () => {
    const { calls, db } = database([row()]);
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ id: 'meta-user', name: 'Coffee Story' }));
    assert.deepEqual(await runConnectorOAuthIdentities(db, NOW), {
      claimed: 1, completed: 1, failed: 0, stale: 0,
    });
    assert.deepEqual(calls[0], { name: 'claim_connector_oauth_identities', args: {
      p_now: NOW.toISOString(), p_limit: 2, p_lease_seconds: 600,
    } });
    assert.deepEqual(calls[1], { name: 'complete_connector_oauth_identity', args: {
      p_job_id: IDS.job, p_lease_token: IDS.lease, p_now: NOW.toISOString(),
      p_external_account_id: 'meta-user',
    } });
  });

  it('uses the durable QuickBooks realm and rejects a mismatched company', async () => {
    const { calls, db } = database([row('quickbooks-online', {
      identity_hint: { realmId: '12345' },
    })]);
    mock.method(globalThis, 'fetch', async () => Response.json({
      CompanyInfo: { Id: '98765', CompanyName: 'Wrong company' },
    }));
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).failed, 1);
    const failed = calls.find((call) => call.name === 'fail_connector_oauth_identity');
    assert.equal(failed?.args.p_error_code, 'credential_invalid');
    assert.equal(failed?.args.p_retryable, false);
  });

  it('backs off a Slack semantic transient without exposing provider details', async () => {
    const { calls, db } = database([row('slack')]);
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: false, error: 'service_unavailable', detail: 'private' }));
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).failed, 1);
    const failed = calls.find((call) => call.name === 'fail_connector_oauth_identity');
    assert.equal(failed?.args.p_error_code, 'provider_unavailable');
    assert.equal(failed?.args.p_retryable, true);
    assert.ok(!JSON.stringify(calls).includes('private'));
  });

  it('isolates a poisoned job and completes a valid co-batched job', async () => {
    const valid = row('youtube', {
      job_id: '66666666-6666-4666-8666-666666666666',
    });
    const { calls, db } = database([row('slack', { identity_hint: { realmId: 'bad' } }), valid]);
    mock.method(globalThis, 'fetch', async () => Response.json({ sub: 'google-subject' }));
    assert.deepEqual(await runConnectorOAuthIdentities(db, NOW), {
      claimed: 2, completed: 1, failed: 1, stale: 0,
    });
    assert.equal(calls.filter((call) => call.name === 'fail_connector_oauth_identity').length, 1);
    assert.equal(calls.filter((call) => call.name === 'complete_connector_oauth_identity').length, 1);
  });
});
