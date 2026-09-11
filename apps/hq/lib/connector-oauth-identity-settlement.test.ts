import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ConnectorOAuthJobError } from './connector-oauth-job-contract';
import { runConnectorOAuthIdentities } from './connector-oauth-identity-maintenance';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const IDS = {
  job: '11111111-1111-4111-8111-111111111111',
  brand: '22222222-2222-4222-8222-222222222222',
  installation: '33333333-3333-4333-8333-333333333333',
  reference: '44444444-4444-4444-8444-444444444444',
  lease: '55555555-5555-4555-8555-555555555555',
};

function row(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    job_id: IDS.job, brand_id: IDS.brand, installation_id: IDS.installation,
    credential_reference_id: IDS.reference, provider_key: 'slack',
    credential_generation: 1, lease_token: IDS.lease,
    credential: { access_token: 'issued-access' }, account_label: 'Pending',
    expires_at: null, granted_scopes: [], identity_hint: {}, ...overrides,
  };
}

function database(
  claimed: readonly unknown[],
  settle: (name: string, args: Readonly<Record<string, unknown>>) => unknown = () =>
    ({ data: true, error: null }),
) {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    return name === 'claim_connector_oauth_identities'
      ? { data: claimed, error: null } : settle(name, args);
  } } as unknown as SupabaseClient;
  return { calls, db };
}

afterEach(() => mock.restoreAll());

describe('connector OAuth identity settlement', { concurrency: false }, () => {
  it('backs off HTTP and transport outages but terminalizes explicit 401', async () => {
    for (const response of [
      () => new Response(null, { status: 429 }),
      () => new Response(null, { status: 503 }),
      () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); },
    ]) {
      const { calls, db } = database([row({ provider_key: 'meta-business-suite' })]);
      mock.method(globalThis, 'fetch', async () => response());
      assert.equal((await runConnectorOAuthIdentities(db, NOW)).failed, 1);
      const failed = calls.find((call) => call.name === 'fail_connector_oauth_identity');
      assert.equal(failed?.args.p_retryable, true);
      mock.restoreAll();
    }
    const { calls, db } = database([row({ provider_key: 'meta-business-suite' })]);
    mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).failed, 1);
    const failed = calls.find((call) => call.name === 'fail_connector_oauth_identity');
    assert.equal(failed?.args.p_error_code, 'credential_invalid');
    assert.equal(failed?.args.p_retryable, false);
  });

  it('treats scalar Slack payloads as retryable and identity mismatch as terminal', async () => {
    let payload: unknown = 17;
    const { calls, db } = database([row()]);
    mock.method(globalThis, 'fetch', async () => Response.json(payload));
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).failed, 1);
    let failed = calls.find((call) => call.name === 'fail_connector_oauth_identity');
    assert.equal(failed?.args.p_error_code, 'payload');
    assert.equal(failed?.args.p_retryable, true);
    mock.restoreAll();
    payload = { data: { user: { open_id: 'different', display_name: 'Wrong' } } };
    const mismatch = database([row({ provider_key: 'tiktok',
      credential: { access_token: 'issued-access', open_id: 'expected' } })]);
    mock.method(globalThis, 'fetch', async () => Response.json(payload));
    assert.equal((await runConnectorOAuthIdentities(mismatch.db, NOW)).failed, 1);
    failed = mismatch.calls.find((call) => call.name === 'fail_connector_oauth_identity');
    assert.equal(failed?.args.p_error_code, 'credential_invalid');
    assert.equal(failed?.args.p_retryable, false);
  });

  it('reports stale CAS outcomes and accepts a lost settlement response replay', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, team_id: 'T1' }));
    let { db } = database([row()], () => ({ data: false, error: null }));
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).stale, 1);
    let settles = 0;
    ({ db } = database([row()], () => {
      settles += 1;
      if (settles === 1) throw new Error('response lost');
      return { data: true, error: null };
    }));
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).completed, 1);
    assert.equal(settles, 2);
  });

  it('continues a co-batched job before reporting an exhausted settlement', async () => {
    const second = row({ job_id: '66666666-6666-4666-8666-666666666666' });
    let fetches = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetches += 1;
      return Response.json({ ok: true, team_id: `T${fetches}` });
    });
    const { calls, db } = database([row(), second], (_name, args) => {
      if (args.p_job_id === IDS.job) throw new Error('database unavailable');
      return { data: true, error: null };
    });
    await assert.rejects(runConnectorOAuthIdentities(db, NOW), (error: unknown) =>
      error instanceof ConnectorOAuthJobError && error.stage === 'settlement');
    assert.equal(fetches, 2);
    assert.ok(calls.some((call) => call.args.p_job_id === second.job_id));
  });
});
