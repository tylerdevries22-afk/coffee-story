import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runConnectorOAuthRefreshes,
  runConnectorOAuthRevocations,
} from './connector-oauth-maintenance';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const IDS = [
  '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const;

function row(kind: 'refresh' | 'revocation') {
  return {
    job_id: IDS[0], brand_id: IDS[1], installation_id: IDS[2],
    credential_reference_id: IDS[3], provider_key: 'slack',
    credential_generation: 1, lease_token: IDS[4],
    credential: { access_token: 'expired-access', refresh_token: 'old-refresh',
      external_account_id: 'T1', expires_in: 60, acquired_at: '2026-09-08T10:00:00.000Z' },
    account_label: 'Workspace', expires_at: kind === 'revocation'
      ? '2026-09-08T11:00:00.000Z' : '2026-09-08T12:05:00.000Z',
    granted_scopes: ['chat:write'],
  };
}

function database(
  kind: 'refresh' | 'revocation',
  result: (name: string, count: number) => boolean | Error,
  events: string[],
) {
  const counts = new Map<string, number>();
  return { rpc: async (name: string) => {
    events.push(name);
    if (name === `claim_connector_oauth_${kind === 'refresh' ? 'refreshes' : 'revocations'}`) {
      return { data: [row(kind)], error: null };
    }
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    const value = result(name, count);
    if (value instanceof Error) throw value;
    return { data: value, error: null };
  } } as unknown as SupabaseClient;
}

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth rotation request start', { concurrency: false }, () => {
  for (const kind of ['refresh', 'revocation'] as const) {
    it(`stops a stale ${kind} lease before contacting the provider`, async () => {
      configureOauthTestEnv();
      const events: string[] = [];
      const db = database(kind, (name) =>
        name === 'start_connector_oauth_credential_rotation' ? false : true, events);
      const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
      const result = kind === 'refresh'
        ? await runConnectorOAuthRefreshes(db, NOW)
        : await runConnectorOAuthRevocations(db, NOW);
      assert.equal(result.stale, 1);
      assert.equal(fetchMock.mock.callCount(), 0);
      assert.ok(events.includes('start_connector_oauth_credential_rotation'));
    });
  }

  it('replays a lost start response before one provider request', async () => {
    configureOauthTestEnv();
    const events: string[] = [];
    const db = database('refresh', (name, count) =>
      name === 'start_connector_oauth_credential_rotation' && count === 1
        ? new Error('response lost') : true, events);
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({
      ok: true, access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3_600,
    }));
    assert.equal((await runConnectorOAuthRefreshes(db, NOW)).completed, 1);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(events.filter((name) =>
      name === 'start_connector_oauth_credential_rotation').length, 2);
    assert.ok(events.indexOf('start_connector_oauth_credential_rotation')
      < events.indexOf('complete_connector_oauth_refresh'));
  });

  it('cancels an ambiguous marker before durable retry without provider I/O', async () => {
    configureOauthTestEnv();
    const events: string[] = [];
    const db = database('refresh', (name) =>
      name === 'start_connector_oauth_credential_rotation'
        ? new Error('response lost') : true, events);
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    assert.equal((await runConnectorOAuthRefreshes(db, NOW)).failed, 1);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(events.filter((name) =>
      name === 'start_connector_oauth_credential_rotation').length, 2);
    assert.ok(events.includes('cancel_connector_oauth_credential_rotation'));
    assert.ok(events.includes('fail_connector_oauth_refresh'));
  });
});
