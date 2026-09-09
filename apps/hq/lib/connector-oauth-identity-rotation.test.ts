import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { runConnectorOAuthIdentities } from './connector-oauth-identity-maintenance';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const IDS = {
  job: '11111111-1111-4111-8111-111111111111',
  brand: '22222222-2222-4222-8222-222222222222',
  installation: '33333333-3333-4333-8333-333333333333',
  reference: '44444444-4444-4444-8444-444444444444',
  lease: '55555555-5555-4555-8555-555555555555',
};

function row(provider: string, credential: Readonly<Record<string, unknown>>) {
  return {
    job_id: IDS.job, brand_id: IDS.brand, installation_id: IDS.installation,
    credential_reference_id: IDS.reference, provider_key: provider,
    credential_generation: 1, lease_token: IDS.lease, credential,
    account_label: 'Pending', expires_at: '2026-09-08T11:00:00.000Z',
    granted_scopes: ['openid'], identity_hint: {},
  };
}

function database(claimed: unknown, outcome: (name: string, count: number) => unknown = () => true) {
  const calls: { name: string; args: Readonly<Record<string, unknown>> }[] = [];
  const counts = new Map<string, number>();
  const db = { rpc: async (name: string, args: Readonly<Record<string, unknown>>) => {
    calls.push({ name, args });
    if (name === 'claim_connector_oauth_identities') return { data: [claimed], error: null };
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    const result = outcome(name, count);
    if (result instanceof Error) throw result;
    return { data: result, error: null };
  } } as unknown as SupabaseClient;
  return { calls, db };
}

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth identity credential rotation', { concurrency: false }, () => {
  it('marks, refreshes, persists, then identifies an expired Google credential', async () => {
    configureOauthTestEnv();
    const events: string[] = [];
    const { calls, db } = database(row('google-suite', {
      access_token: 'expired-access', refresh_token: 'stable-refresh',
    }));
    mock.method(globalThis, 'fetch', async (target) => {
      events.push(String(target).includes('/token') ? 'refresh' : 'identity');
      return events.at(-1) === 'refresh'
        ? Response.json({ access_token: 'fresh-access', expires_in: 3_600 })
        : Response.json({ sub: 'google-user' });
    });
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).completed, 1);
    assert.deepEqual(calls.map(({ name }) => name), [
      'claim_connector_oauth_identities', 'start_connector_oauth_credential_rotation',
      'rotate_connector_oauth_identity_credential', 'complete_connector_oauth_identity',
    ]);
    assert.deepEqual(events, ['refresh', 'identity']);
  });

  it('persists an unidentified TikTok rotation before verifying its profile', async () => {
    configureOauthTestEnv();
    const { calls, db } = database(row('tiktok', {
      access_token: 'expired-access', refresh_token: 'old-refresh', open_id: 'creator-1',
    }));
    let fetches = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetches += 1;
      return fetches === 1 ? Response.json({ data: {
        access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3_600,
        refresh_expires_in: 31_536_000, token_type: 'Bearer', open_id: 'creator-1',
      } }) : Response.json({ data: { user: {
        open_id: 'creator-1', display_name: 'Creator',
      } } });
    });
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).completed, 1);
    const rotated = calls.find((call) => call.name === 'rotate_connector_oauth_identity_credential');
    assert.equal(Reflect.get(rotated?.args.p_credential as object, 'open_id'), 'creator-1');
    assert.equal(fetches, 2);
  });

  it('recovers a short Meta credential before delayed identity lookup', async () => {
    configureOauthTestEnv();
    const { calls, db } = database(row('meta-business-suite', {
      access_token: 'short-access', expires_in: 3_600,
      acquired_at: '2026-09-08T10:00:00.000Z',
    }));
    let fetches = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetches += 1;
      return fetches === 1
        ? Response.json({ access_token: 'long-access', expires_in: 5_184_000 })
        : Response.json({ id: 'meta-user', name: 'Workspace' });
    });
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).completed, 1);
    assert.ok(calls.some((call) => call.name === 'rotate_connector_oauth_identity_credential'));
    assert.equal(fetches, 2);
  });

  it('does not contact a provider after a stale start or stale rotation CAS', async () => {
    configureOauthTestEnv();
    const claimed = row('slack', {
      access_token: 'expired-access', refresh_token: 'old-refresh',
    });
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({
      ok: true, access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3_600,
    }));
    let current = database(claimed, (name) => name === 'start_connector_oauth_credential_rotation'
      ? false : true);
    assert.equal((await runConnectorOAuthIdentities(current.db, NOW)).stale, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
    current = database(claimed, (name) => name === 'rotate_connector_oauth_identity_credential'
      ? false : true);
    assert.equal((await runConnectorOAuthIdentities(current.db, NOW)).stale, 1);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('replays a lost rotation settlement without repeating the provider request', async () => {
    configureOauthTestEnv();
    const { calls, db } = database(row('slack', {
      access_token: 'expired-access', refresh_token: 'old-refresh',
    }), (name, count) => name === 'rotate_connector_oauth_identity_credential' && count === 1
      ? new Error('response lost') : true);
    let fetches = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetches += 1;
      return fetches === 1 ? Response.json({
        ok: true, access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3_600,
      }) : Response.json({ ok: true, team_id: 'T1' });
    });
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).completed, 1);
    assert.equal(fetches, 2);
    assert.equal(calls.filter((call) =>
      call.name === 'rotate_connector_oauth_identity_credential').length, 2);
  });

  it('refreshes once after a current YouTube access token is rejected', async () => {
    configureOauthTestEnv();
    const claimed = { ...row('youtube', {
      access_token: 'current-access', refresh_token: 'stable-refresh',
    }), expires_at: '2026-09-08T13:00:00.000Z' };
    const { calls, db } = database(claimed);
    let fetches = 0;
    mock.method(globalThis, 'fetch', async (target) => {
      fetches += 1;
      if (fetches === 1) return new Response(null, { status: 401 });
      if (String(target).includes('/token')) {
        return Response.json({ access_token: 'fresh-access', expires_in: 3_600 });
      }
      return Response.json({ sub: 'google-user' });
    });
    assert.equal((await runConnectorOAuthIdentities(db, NOW)).completed, 1);
    assert.equal(fetches, 3);
    assert.deepEqual(calls.map(({ name }) => name), [
      'claim_connector_oauth_identities', 'start_connector_oauth_credential_rotation',
      'rotate_connector_oauth_identity_credential', 'complete_connector_oauth_identity',
    ]);
  });
});
