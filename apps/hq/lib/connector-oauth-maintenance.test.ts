import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { ConnectorOAuthJobError } from './connector-oauth-job-contract';
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
const NOW = new Date('2026-09-08T12:00:00.000Z');

function row(
  provider: string,
  credential: Readonly<Record<string, unknown>>,
  expiresAt = '2026-09-08T12:05:00.000Z',
) {
  return {
    job_id: IDS.job, brand_id: IDS.brand, installation_id: IDS.installation,
    credential_reference_id: IDS.reference, provider_key: provider,
    credential_generation: 4, lease_token: IDS.lease,
    credential: { external_account_id: 'connected-account', ...credential },
    account_label: 'Connected account', expires_at: expiresAt,
    granted_scopes: ['channels:read', 'chat:write'],
  };
}

function database(
  claimName: string,
  claimed: readonly unknown[],
  calls: { name: string; args: Readonly<Record<string, unknown>> }[],
): SupabaseClient {
  return { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    if (name === claimName) return { data: claimed, error: null };
    return { data: true, error: null };
  } } as unknown as SupabaseClient;
}

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth maintenance', { concurrency: false }, () => {
  it('claims and CAS-completes a refreshed credential', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({
      access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3_600,
      scope: 'chat:write unrequested:scope',
    }));
    const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
    const db = database('claim_connector_oauth_refreshes', [row('youtube', {
      access_token: 'old-access', refresh_token: 'old-refresh', external_account_id: 'channel-1',
    })], calls);

    assert.deepEqual(await runConnectorOAuthRefreshes(db, NOW), {
      claimed: 1, completed: 1, failed: 0, stale: 0,
    });
    assert.deepEqual(calls[0], {
      name: 'claim_connector_oauth_refreshes',
      args: { p_now: NOW.toISOString(), p_limit: 2, p_lease_seconds: 600 },
    });
    const completed = calls.find((call) => call.name === 'complete_connector_oauth_refresh');
    assert.equal(completed?.args.p_job_id, IDS.job);
    assert.equal(completed?.args.p_lease_token, IDS.lease);
    assert.equal(completed?.args.p_expires_at, '2026-09-08T13:00:00.000Z');
    assert.equal(Reflect.get(completed?.args.p_credential as object, 'external_account_id'), 'channel-1');
    assert.deepEqual(Reflect.get(completed?.args.p_credential as object, 'granted_scopes'),
      ['chat:write']);
  });

  it('permanently degrades an invalid refresh grant with a safe marker', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({
      error: 'invalid_grant', error_description: 'sensitive provider detail',
    }, { status: 400 }));
    const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
    const db = database('claim_connector_oauth_refreshes', [row('google-suite', {
      access_token: 'old-access', refresh_token: 'old-refresh',
    })], calls);

    assert.equal((await runConnectorOAuthRefreshes(db, NOW)).failed, 1);
    const failed = calls.find((call) => call.name === 'fail_connector_oauth_refresh');
    assert.equal(failed?.args.p_error_code, 'invalid_grant');
    assert.equal(failed?.args.p_retryable, false);
    assert.ok(!JSON.stringify(failed).includes('sensitive provider detail'));
  });

  it('refreshes an expired Slack access token before fully uninstalling', async () => {
    configureOauthTestEnv();
    const urls: string[] = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (
      input: string | URL | Request,
    ) => {
      const url = String(input);
      urls.push(url);
      return url.includes('oauth.v2.access')
        ? Response.json({ ok: true, access_token: 'fresh-access',
          refresh_token: 'fresh-refresh', expires_in: 43_200 })
        : Response.json({ ok: true });
    });
    const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
    const db = database('claim_connector_oauth_revocations', [row('slack', {
      access_token: 'expired-access', refresh_token: 'durable-refresh', expires_in: 60,
      acquired_at: '2026-09-08T10:00:00.000Z',
    }, '2026-09-08T11:00:00.000Z')], calls);

    assert.equal((await runConnectorOAuthRevocations(db, NOW)).completed, 1);
    assert.deepEqual(urls, [
      'https://slack.com/api/oauth.v2.access', 'https://slack.com/api/apps.uninstall',
    ]);
    const rotation = calls.find((call) =>
      call.name === 'rotate_connector_oauth_revocation_credential');
    assert.equal(Reflect.get(rotation?.args.p_credential as object, 'access_token'), 'fresh-access');
    assert.ok(calls.some((call) => call.name === 'complete_connector_oauth_revocation'));
    const uninstall = fetchMock.mock.calls[1]?.arguments[1] as RequestInit | undefined;
    assert.equal((uninstall?.body as URLSearchParams).get('token'), 'fresh-access');
  });

  it('persists a rotation before retrying a transient uninstall', async () => {
    configureOauthTestEnv();
    let stored: Readonly<Record<string, unknown>> = {
      access_token: 'expired-access', refresh_token: 'old-refresh', expires_in: 60,
      acquired_at: '2026-09-08T10:00:00.000Z',
    };
    let claimCount = 0;
    const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
      if (name === 'claim_connector_oauth_revocations') {
        claimCount += 1;
        return { data: [row('slack', stored, '2026-09-08T11:00:00.000Z')], error: null };
      }
      if (name === 'rotate_connector_oauth_revocation_credential') {
        stored = args.p_credential as Readonly<Record<string, unknown>>;
      }
      return { data: true, error: null };
    } } as unknown as SupabaseClient;
    let uninstallCalls = 0;
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      if (String(input).includes('oauth.v2.access')) {
        return Response.json({ ok: true, access_token: 'rotated-access',
          refresh_token: 'rotated-refresh', expires_in: 43_200 });
      }
      uninstallCalls += 1;
      return uninstallCalls <= 2
        ? new Response(null, { status: 503 }) : Response.json({ ok: true });
    });

    assert.equal((await runConnectorOAuthRevocations(db, NOW)).failed, 1);
    assert.equal(stored.access_token, 'rotated-access');
    assert.equal((await runConnectorOAuthRevocations(db, NOW)).completed, 1);
    assert.equal(claimCount, 2);
    assert.equal(uninstallCalls, 3);
  });

  it('retains evidence when a revocation refresh returns invalid_grant', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({
      ok: false, error: 'invalid_grant', error_description: 'private detail',
    }, { status: 400 }));
    const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
    const db = database('claim_connector_oauth_revocations', [row('slack', {
      access_token: 'expired-access', refresh_token: 'revoked-refresh', expires_in: 60,
      acquired_at: '2026-09-08T10:00:00.000Z',
    }, '2026-09-08T11:00:00.000Z')], calls);

    assert.equal((await runConnectorOAuthRevocations(db, NOW)).failed, 1);
    const failed = calls.find((call) => call.name === 'fail_connector_oauth_revocation');
    assert.equal(failed?.args.p_error_code, 'invalid_grant');
    assert.equal(failed?.args.p_retryable, false);
    assert.ok(!JSON.stringify(calls).includes('private detail'));
  });

  it('fails closed on malformed claims without exposing database details', async () => {
    const db = { rpc: async () => ({
      data: [{ ...row('youtube', { access_token: 'token' }), lease_token: 'not-a-uuid' }],
      error: { message: 'sensitive database detail' },
    }) } as unknown as SupabaseClient;
    await assert.rejects(runConnectorOAuthRefreshes(db, NOW), (error: unknown) => {
      assert.ok(error instanceof ConnectorOAuthJobError);
      assert.equal(error.stage, 'claim');
      assert.ok(!error.message.includes('sensitive database detail'));
      return true;
    });
  });
});
