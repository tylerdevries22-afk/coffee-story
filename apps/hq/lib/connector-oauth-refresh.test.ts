import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ConnectorRefreshError,
  refreshConnectorToken,
} from './connector-oauth-refresh';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

const credential = { access_token: 'old-access', refresh_token: 'old-refresh',
  external_account_id: 'workspace-1' };

describe('refreshConnectorToken', { concurrency: false }, () => {
  it('uses each provider contract and requires rotating-provider refresh tokens', async () => {
    configureOauthTestEnv();
    const requests: Request[] = [];
    mock.method(globalThis, 'fetch', async (
      input: string | URL | Request, init?: RequestInit,
    ) => {
      requests.push(new Request(input, init));
      const replacement = String(input).includes('intuit.com')
        || String(input).includes('slack.com') || String(input).includes('tiktokapis.com');
      const tiktok = String(input).includes('tiktokapis.com');
      return Response.json({
        ok: true, access_token: 'new-access', expires_in: 3_600,
        ...(replacement ? { refresh_token: 'rotated-refresh' } : {}),
        ...(tiktok ? { token_type: 'Bearer', refresh_expires_in: 31_536_000,
          open_id: 'workspace-1' } : {}),
      });
    });

    for (const provider of [
      'google-suite', 'youtube', 'quickbooks-online', 'slack', 'tiktok',
    ] as const) {
      const token = await refreshConnectorToken(provider, credential);
      assert.equal(token?.access_token, 'new-access');
      assert.equal(token?.refresh_token,
        provider === 'google-suite' || provider === 'youtube' ? 'old-refresh' : 'rotated-refresh');
    }
    const bodies = await Promise.all(requests.map((request) => request.text()));
    assert.match(bodies[0]!, /client_id=123456789-google/u);
    assert.match(bodies[1]!, /client_id=123456789-youtube/u);
    assert.match(requests[2]!.headers.get('authorization') ?? '', /^Basic /u);
    assert.match(bodies[3]!, /client_id=slack-client/u);
    assert.match(bodies[4]!, /client_key=tiktok-key/u);
    assert.ok(bodies.every((body) => body.includes('refresh_token=old-refresh')));
  });

  it('persists rotations and stable identity metadata across provider payloads', async () => {
    configureOauthTestEnv();
    const responses = [
      { ok: true, access_token: 'slack-access', refresh_token: 'slack-refresh',
        external_account_id: 'attacker-workspace', expires_in: 3_600 },
      { data: { access_token: 'tiktok-access', refresh_token: 'tiktok-refresh',
        expires_in: 7_200, refresh_expires_in: 31_536_000,
        token_type: 'Bearer', open_id: 'workspace-1' } },
    ];
    mock.method(globalThis, 'fetch', async () => Response.json(responses.shift()));
    const previous = { ...credential, external_account_id: 'workspace-1', expires_in: 10 };
    const slack = await refreshConnectorToken('slack', previous);
    const tiktok = await refreshConnectorToken('tiktok', credential);
    assert.equal(slack?.refresh_token, 'slack-refresh');
    assert.equal(slack?.external_account_id, 'workspace-1');
    assert.equal(slack?.expires_in, 3_600);
    assert.equal(tiktok?.refresh_token, 'tiktok-refresh');
  });

  it('retries transient responses and provable pre-delivery failures once', async () => {
    configureOauthTestEnv();
    let calls = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) return new Response(null, { status: 429 });
      return Response.json({ access_token: 'new-access', expires_in: 3_600 });
    });
    assert.equal((await refreshConnectorToken('youtube', credential))?.access_token, 'new-access');
    assert.equal(fetchMock.mock.callCount(), 2);

    fetchMock.mock.restore();
    calls = 0;
    const transportMock = mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      }
      return Response.json({ access_token: 'new-after-dns', expires_in: 3_600 });
    });
    assert.equal(
      (await refreshConnectorToken('youtube', credential, 5))?.access_token,
      'new-after-dns',
    );
    assert.equal(transportMock.mock.callCount(), 2);
  });

  it('does not replay a rotating refresh after an ambiguous transport failure', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('socket closed with secret details', { cause: { code: 'ECONNRESET' } });
    });
    await assert.rejects(refreshConnectorToken('slack', credential, 5), (error: unknown) => {
      assert.ok(error instanceof ConnectorRefreshError);
      assert.equal(error.stage, 'transport');
      assert.equal(error.retryable, false);
      assert.ok(!error.message.includes('secret details'));
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('uses Slack grace once for 5xx and lets reusable grants back off', async () => {
    configureOauthTestEnv();
    let fetchMock = mock.method(globalThis, 'fetch', async () =>
      new Response(null, { status: 502 }));
    await assert.rejects(refreshConnectorToken('slack', credential), (error: unknown) => {
      assert.ok(error instanceof ConnectorRefreshError);
      assert.equal(error.stage, 'provider');
      assert.equal(error.status, 502);
      assert.equal(error.code, 'rotation_ambiguous');
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 2);
    fetchMock.mock.restore();
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      new Response(null, { status: 502 }));
    await assert.rejects(refreshConnectorToken('youtube', credential), (error: unknown) =>
      error instanceof ConnectorRefreshError && error.retryable);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('only retries Slack semantic errors with an allowlisted safe signal', async () => {
    configureOauthTestEnv();
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ ok: false, error: 'internal_error' })
        : Response.json({ ok: true, access_token: 'new-access',
          refresh_token: 'new-refresh', expires_in: 3_600 });
    });
    assert.equal((await refreshConnectorToken('slack', credential))?.access_token, 'new-access');
    assert.equal(calls, 2);
    mock.restoreAll();
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: false, error: 'fatal_error' }));
    await assert.rejects(refreshConnectorToken('slack', credential), (error: unknown) =>
      error instanceof ConnectorRefreshError && error.code === 'rotation_ambiguous'
        && !error.retryable);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

});
