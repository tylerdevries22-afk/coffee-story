import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  connectorAuthorizationUrl,
  connectorCallbackUrl,
  connectorProviderReady,
  exchangeConnectorCode,
  grantedConnectorScopes,
  verifyConnectorIdentity,
} from './connector-oauth-providers';

const ENV = [
  'CONNECTOR_PUBLIC_ORIGIN', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_PROJECT_NUMBER', 'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_TOKEN_ROTATION_ENABLED',
  'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_ENV',
] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

afterEach(() => {
  mock.restoreAll();
  for (const name of ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('connector OAuth providers', { concurrency: false }, () => {
  it('builds an exact Google PKCE authorization request', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
    const url = connectorAuthorizationUrl(
      'google-suite', 'signed-state', 'challenge',
      'https://hq.example.com/api/connectors/google-suite/callback',
    );

    assert.equal(url?.origin, 'https://accounts.google.com');
    assert.equal(url?.searchParams.get('state'), 'signed-state');
    assert.equal(url?.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url?.searchParams.get('access_type'), 'offline');
    assert.match(url?.searchParams.get('scope') ?? '', /drive\.file/);
  });

  it('requires Google and YouTube clients to match their shared Cloud project', () => {
    process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
    process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.YOUTUBE_OAUTH_CLIENT_ID = '987654321-youtube.apps.googleusercontent.com';
    process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'youtube-secret';
    assert.equal(connectorProviderReady('google-suite'), true);
    assert.equal(connectorProviderReady('youtube'), false);
    process.env.YOUTUBE_OAUTH_CLIENT_ID = '123456789-youtube.apps.googleusercontent.com';
    assert.equal(connectorProviderReady('youtube'), true);
  });

  it('requires an explicit supported QuickBooks environment', () => {
    process.env.QUICKBOOKS_CLIENT_ID = 'quickbooks-client';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'quickbooks-secret';
    delete process.env.QUICKBOOKS_ENV;
    assert.equal(connectorProviderReady('quickbooks-online'), false);
    process.env.QUICKBOOKS_ENV = 'sandobx';
    assert.equal(connectorProviderReady('quickbooks-online'), false);
    process.env.QUICKBOOKS_ENV = 'sandbox';
    assert.equal(connectorProviderReady('quickbooks-online'), true);
    process.env.QUICKBOOKS_ENV = 'production';
    assert.equal(connectorProviderReady('quickbooks-online'), true);
  });

  it('fails closed on insecure or path-bearing production origins', () => {
    process.env.CONNECTOR_PUBLIC_ORIGIN = 'http://hq.example.com';
    assert.equal(connectorCallbackUrl('slack', 'https://ignored.example'), null);
    process.env.CONNECTOR_PUBLIC_ORIGIN = 'https://hq.example.com/unexpected';
    assert.equal(connectorCallbackUrl('slack', 'https://ignored.example'), null);
  });

  it('uses Slack confidential-client OAuth and bounds explicit response retries', async () => {
    process.env.SLACK_CLIENT_ID = 'slack-client';
    process.env.SLACK_CLIENT_SECRET = 'slack-secret';
    process.env.SLACK_TOKEN_ROTATION_ENABLED = 'true';
    const authorize = connectorAuthorizationUrl(
      'slack', 'signed-state', 'unused-challenge', 'https://hq.example/callback',
    );
    assert.equal(authorize?.searchParams.has('code_challenge'), false);
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429 }));

    await assert.rejects(
      exchangeConnectorCode('slack', 'one-time-code', 'v'.repeat(43), 'https://hq.example/callback'),
      /token exchange failed/i,
    );
    assert.equal(fetchMock.mock.callCount(), 2);
    const target = fetchMock.mock.calls[0]?.arguments[0];
    assert.ok(target);
    const request = new Request(target, fetchMock.mock.calls[0]?.arguments[1]);
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get('client_secret'), 'slack-secret');
    assert.equal(body.has('code_verifier'), false);
  });

  it('verifies the live Google account before accepting a grant', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ sub: 'user-1', email: 'owner@example.com' }));
    assert.deepEqual(
      await verifyConnectorIdentity('google-suite', { access_token: 'access-token' }, null),
      { accountId: 'user-1', accountLabel: 'owner@example.com' },
    );
  });

  it('reads QuickBooks company info from the endpoint response shape', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      CompanyInfo: { Id: '934145', CompanyName: 'Juniper Base Demo' },
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('quickbooks-online', { access_token: 'access-token' }, '934145'),
      { accountId: '934145', accountLabel: 'Juniper Base Demo' },
    );
  });

  it('deduplicates provider-reported granted scopes', () => {
    assert.deepEqual(
      grantedConnectorScopes({ access_token: 'token', scope: 'chat:write,channels:read chat:write' }),
      ['chat:write', 'channels:read'],
    );
  });
});
