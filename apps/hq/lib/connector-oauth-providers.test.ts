import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  connectorAuthorizationUrl,
  connectorCallbackUrl,
  exchangeConnectorCode,
  grantedConnectorScopes,
  verifyConnectorIdentity,
} from './connector-oauth-providers';

const ENV = [
  'CONNECTOR_PUBLIC_ORIGIN', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET',
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
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
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

  it('fails closed on insecure or path-bearing production origins', () => {
    process.env.CONNECTOR_PUBLIC_ORIGIN = 'http://hq.example.com';
    assert.equal(connectorCallbackUrl('slack', 'https://ignored.example'), null);
    process.env.CONNECTOR_PUBLIC_ORIGIN = 'https://hq.example.com/unexpected';
    assert.equal(connectorCallbackUrl('slack', 'https://ignored.example'), null);
  });

  it('never retries the non-idempotent authorization-code exchange', async () => {
    process.env.SLACK_CLIENT_ID = 'slack-client';
    process.env.SLACK_CLIENT_SECRET = 'slack-secret';
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));

    await assert.rejects(
      exchangeConnectorCode('slack', 'one-time-code', 'v'.repeat(43), 'https://hq.example/callback'),
      /could not complete/i,
    );
    assert.equal(fetchMock.mock.callCount(), 1);
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
      grantedConnectorScopes('slack', { access_token: 'token', scope: 'chat:write,channels:read chat:write' }),
      ['chat:write', 'channels:read'],
    );
  });
});
