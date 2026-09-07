import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  connectorAuthorizationUrl,
  connectorProviderReady,
  exchangeConnectorCode,
  isOAuthConnectorKey,
  verifyConnectorIdentity,
} from './connector-oauth-providers';

const ENV = [
  'META_APP_ID', 'META_APP_SECRET',
  'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

function configure(): void {
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-secret';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = 'youtube-client';
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'youtube-secret';
  process.env.TIKTOK_CLIENT_KEY = 'tiktok-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tiktok-secret';
}

afterEach(() => {
  mock.restoreAll();
  for (const name of ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('publishing and social OAuth providers', { concurrency: false }, () => {
  it('registers the three new providers as OAuth connector keys', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok']) {
      assert.ok(isOAuthConnectorKey(key), `${key} should be an OAuth key`);
    }
  });

  it('reports every new provider unconfigured until both secrets are present', () => {
    for (const key of ['meta-business-suite', 'youtube', 'tiktok'] as const) {
      assert.equal(connectorProviderReady(key), false, `${key} must fail closed`);
    }
    configure();
    for (const key of ['meta-business-suite', 'youtube', 'tiktok'] as const) {
      assert.equal(connectorProviderReady(key), true);
    }
  });

  it('names TikTok client_key, not client_id, and comma-separates its scopes', () => {
    configure();
    const url = connectorAuthorizationUrl(
      'tiktok', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/tiktok/callback',
    );

    assert.equal(url?.origin, 'https://www.tiktok.com');
    assert.equal(url?.pathname, '/v2/auth/authorize/');
    assert.equal(url?.searchParams.get('client_key'), 'tiktok-key');
    assert.equal(url?.searchParams.get('client_id'), null);
    assert.equal(url?.searchParams.get('code_challenge_method'), 'S256');
    assert.match(url?.searchParams.get('scope') ?? '', /^user\.info\.basic,/);
  });

  it('builds a versioned Meta dialog without PKCE parameters it ignores', () => {
    configure();
    const url = connectorAuthorizationUrl(
      'meta-business-suite', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/meta-business-suite/callback',
    );

    assert.equal(url?.origin, 'https://www.facebook.com');
    assert.equal(url?.pathname, '/v25.0/dialog/oauth');
    assert.equal(url?.searchParams.get('client_id'), 'meta-app');
    assert.equal(url?.searchParams.get('code_challenge'), null);
    assert.match(url?.searchParams.get('scope') ?? '', /business_management/);
  });

  it('asks Google for offline YouTube scopes so refresh tokens arrive', () => {
    configure();
    const url = connectorAuthorizationUrl(
      'youtube', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/youtube/callback',
    );

    assert.equal(url?.origin, 'https://accounts.google.com');
    assert.equal(url?.searchParams.get('access_type'), 'offline');
    assert.match(url?.searchParams.get('scope') ?? '', /youtube\.upload/);
    assert.match(url?.searchParams.get('scope') ?? '', /yt-analytics\.readonly/);
  });

  it('exchanges the Meta code over GET, the only method its endpoint documents', async () => {
    configure();
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ access_token: 'meta-token', expires_in: 5_184_000 }));

    const token = await exchangeConnectorCode(
      'meta-business-suite', 'one-time-code', 'v'.repeat(43),
      'https://hq.example.com/api/connectors/meta-business-suite/callback',
    );

    assert.equal(token.access_token, 'meta-token');
    const [target, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.equal((init as RequestInit | undefined)?.method, undefined);
    assert.match(String(target), /^https:\/\/graph\.facebook\.com\/v25\.0\/oauth\/access_token\?/);
    assert.match(String(target), /client_secret=meta-secret/);
  });

  it('accepts the TikTok token whether it is nested under data or not', async () => {
    configure();
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ data: { access_token: 'tiktok-token', open_id: 'creator-1' } }));

    const token = await exchangeConnectorCode(
      'tiktok', 'one-time-code', 'v'.repeat(43),
      'https://hq.example.com/api/connectors/tiktok/callback',
    );
    assert.equal(token.access_token, 'tiktok-token');
  });

  it('identifies the YouTube channel rather than the signed-in person', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      items: [{ id: 'UC_channel', snippet: { title: 'Coffee Story' } }],
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('youtube', { access_token: 'access-token' }, null),
      { accountId: 'UC_channel', accountLabel: 'Coffee Story' },
    );
  });

  it('identifies a TikTok creator from the nested user payload', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      data: { user: { open_id: 'creator-1', display_name: 'Coffee Story' } },
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('tiktok', { access_token: 'access-token' }, null),
      { accountId: 'creator-1', accountLabel: 'Coffee Story' },
    );
  });

  it('identifies the Meta business user behind the grant', async () => {
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ id: '10000000000', name: 'Coffee Story HQ' }));
    assert.deepEqual(
      await verifyConnectorIdentity('meta-business-suite', { access_token: 'access-token' }, null),
      { accountId: '10000000000', accountLabel: 'Coffee Story HQ' },
    );
  });

  it('rejects a grant whose identity call returns no usable account', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
    await assert.rejects(
      verifyConnectorIdentity('youtube', { access_token: 'access-token' }, null),
      /identity verification failed/i,
    );
  });
});
