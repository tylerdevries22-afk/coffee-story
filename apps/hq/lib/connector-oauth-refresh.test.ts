import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ConnectorRefreshError,
  connectorTokenExpiry,
  refreshConnectorToken,
} from './connector-oauth-refresh';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

const credential = { access_token: 'old-access', refresh_token: 'old-refresh' };

describe('refreshConnectorToken', { concurrency: false }, () => {
  it('uses each provider refresh contract and preserves an unrotated refresh token', async () => {
    configureOauthTestEnv();
    const requests: Request[] = [];
    mock.method(globalThis, 'fetch', async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ access_token: 'new-access', expires_in: 3_600 });
    });

    for (const provider of [
      'google-suite', 'youtube', 'quickbooks-online', 'slack', 'tiktok',
    ] as const) {
      const token = await refreshConnectorToken(provider, credential);
      assert.equal(token?.access_token, 'new-access');
      assert.equal(token?.refresh_token, 'old-refresh');
    }
    const bodies = await Promise.all(requests.map((request) => request.text()));
    assert.match(bodies[0]!, /client_id=google-client/u);
    assert.match(bodies[1]!, /client_id=youtube-client/u);
    assert.match(requests[2]!.headers.get('authorization') ?? '', /^Basic /u);
    assert.match(bodies[3]!, /client_id=slack-client/u);
    assert.match(bodies[4]!, /client_key=tiktok-key/u);
    assert.ok(bodies.every((body) => body.includes('refresh_token=old-refresh')));
  });

  it('persists rotated Slack refresh tokens and accepts nested TikTok tokens', async () => {
    configureOauthTestEnv();
    const responses = [
      { ok: true, access_token: 'slack-access', refresh_token: 'slack-refresh' },
      { data: { access_token: 'tiktok-access', refresh_token: 'tiktok-refresh' } },
    ];
    mock.method(globalThis, 'fetch', async () => Response.json(responses.shift()));
    const slack = await refreshConnectorToken('slack', credential);
    const tiktok = await refreshConnectorToken('tiktok', credential);
    assert.equal(slack?.refresh_token, 'slack-refresh');
    assert.equal(tiktok?.refresh_token, 'tiktok-refresh');
  });

  it('retries transient responses and transport failures once', async () => {
    configureOauthTestEnv();
    let calls = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 503 });
      return Response.json({ access_token: 'new-access' });
    });
    assert.equal((await refreshConnectorToken('youtube', credential))?.access_token, 'new-access');
    assert.equal(fetchMock.mock.callCount(), 2);

    fetchMock.mock.restore();
    calls = 0;
    const transportMock = mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      throw new Error('socket closed with secret details');
    });
    await assert.rejects(refreshConnectorToken('youtube', credential, 5), (error: unknown) => {
      assert.ok(error instanceof ConnectorRefreshError);
      assert.equal(error.stage, 'transport');
      assert.ok(!error.message.includes('secret details'));
      return true;
    });
    assert.equal(transportMock.mock.callCount(), 2);
  });

  it('fails on provider errors and oversized bodies without leaking provider text', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json(
      { error: 'invalid_grant', error_description: 'refresh secret leaked' }, { status: 400 },
    ));
    await assert.rejects(refreshConnectorToken('google-suite', credential), (error: unknown) => {
      assert.ok(error instanceof ConnectorRefreshError);
      assert.equal(error.stage, 'provider');
      assert.ok(!error.message.includes('refresh secret leaked'));
      return true;
    });
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => new Response('{}', {
      headers: { 'content-length': '20001' },
    }));
    await assert.rejects(refreshConnectorToken('youtube', credential), ConnectorRefreshError);
  });

  it('skips providers without refresh-token rotation and computes expiry safely', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    assert.equal(await refreshConnectorToken('stripe', credential), null);
    assert.equal(await refreshConnectorToken('meta-business-suite', credential), null);
    assert.equal(await refreshConnectorToken('youtube', { access_token: 'only' }), null);
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(
      connectorTokenExpiry({ access_token: 'new', expires_in: 60 }, new Date(0)),
      '1970-01-01T00:01:00.000Z',
    );
  });
});
