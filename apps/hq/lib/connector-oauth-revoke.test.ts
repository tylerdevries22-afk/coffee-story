import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  revokeConnectorToken,
  revokeConnectorTokenDetailed,
} from './connector-oauth-revoke';
import {
  configureOauthTestEnv,
  restoreOauthTestEnv,
  stalledJsonResponse,
} from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

function callFor(
  calls: readonly { arguments: readonly unknown[] }[],
  fragment: string,
): [string, RequestInit] {
  const args = calls.find((call) => String(call.arguments[0]).includes(fragment))?.arguments;
  assert.ok(args, `missing ${fragment} revocation`);
  return [String(args[0]), args[1] as RequestInit];
}

function bodyOf(init: RequestInit): URLSearchParams {
  assert.ok(init.body instanceof URLSearchParams);
  return init.body;
}

describe('revokeConnectorToken', { concurrency: false }, () => {
  it('uses every provider supported revocation contract without URL credentials', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('stripe.com')) return Response.json({ stripe_user_id: 'acct_123' });
      if (url.includes('slack.com')) return Response.json({ ok: true, revoked: true });
      if (url.includes('facebook.com')) return Response.json({ success: true });
      return new Response(null, { status: 200 });
    });
    const token = {
      access_token: 'issued-access', refresh_token: 'issued-refresh', stripe_user_id: 'acct_123',
    };
    for (const provider of [
      'google-suite', 'youtube', 'stripe', 'quickbooks-online', 'slack',
      'meta-business-suite', 'tiktok',
    ] as const) {
      assert.equal(await revokeConnectorToken(provider, token), true, provider);
    }
    assert.equal(fetchMock.mock.callCount(), 7);
    for (const call of fetchMock.mock.calls) {
      assert.ok(!String(call.arguments[0]).includes('issued-access'));
      assert.ok(!String(call.arguments[0]).includes('issued-refresh'));
    }

    for (const name of ['oauth2.googleapis.com/revoke']) {
      const matching = fetchMock.mock.calls.filter((call) => String(call.arguments[0]).includes(name));
      assert.equal(matching.length, 2);
      for (const call of matching) assert.equal(bodyOf(call.arguments[1] as RequestInit).get('token'), 'issued-refresh');
    }
    const [, stripe] = callFor(fetchMock.mock.calls, 'stripe.com/oauth/deauthorize');
    assert.equal(stripe.method, 'POST');
    assert.equal(bodyOf(stripe).get('stripe_user_id'), 'acct_123');
    assert.equal(new Headers(stripe.headers).get('authorization'),
      `Basic ${Buffer.from('stripe-secret:').toString('base64')}`);

    const [, quickbooks] = callFor(fetchMock.mock.calls, 'intuit.com/v2/oauth2/tokens/revoke');
    assert.equal(quickbooks.body, JSON.stringify({ token: 'issued-refresh' }));
    assert.equal(new Headers(quickbooks.headers).get('content-type'), 'application/json');
    assert.equal(new Headers(quickbooks.headers).get('authorization'),
      `Basic ${Buffer.from('quickbooks-client:quickbooks-secret').toString('base64')}`);

    const [, slack] = callFor(fetchMock.mock.calls, 'slack.com/api/apps.uninstall');
    assert.equal(new Headers(slack.headers).get('authorization'), null);
    assert.deepEqual(Object.fromEntries(bodyOf(slack)), {
      client_id: 'slack-client', client_secret: 'slack-secret', token: 'issued-access',
    });
    const [, meta] = callFor(fetchMock.mock.calls, 'facebook.com/v25.0/me/permissions');
    assert.equal(meta.method, 'DELETE');
    assert.equal(new Headers(meta.headers).get('authorization'), 'Bearer issued-access');

    const [, tiktok] = callFor(fetchMock.mock.calls, 'tiktokapis.com/v2/oauth/revoke');
    assert.deepEqual(Object.fromEntries(bodyOf(tiktok)), {
      client_key: 'tiktok-key', client_secret: 'tiktok-secret', token: 'issued-access',
    });
  });

  it('retries a transient response once and then succeeds', async () => {
    configureOauthTestEnv();
    let calls = 0;
    const transient = new Response('retry later', { status: 503 });
    mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return calls === 1 ? transient : new Response(null, { status: 200 });
    });
    assert.equal(await revokeConnectorToken('tiktok', { access_token: 'token' }), true);
    assert.equal(calls, 2);
    assert.equal(transient.body?.locked, false);
  });

  it('keeps the deadline active while reading semantic responses', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) =>
      stalledJsonResponse(init?.signal));
    assert.equal(await revokeConnectorToken('slack', { access_token: 'token' }, undefined, 5), false);
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('fails closed on a provider response that did not confirm revocation', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({ ok: false, error: 'denied' }));
    assert.equal(await revokeConnectorToken('slack', { access_token: 'token' }), false);
  });

  it('requires Stripe to confirm the exact claimed account', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({ stripe_user_id: 'acct_claimed' }));
    assert.equal(await revokeConnectorToken(
      'stripe', { access_token: 'token', stripe_user_id: 'acct_in_token' }, 'acct_claimed',
    ), true);
    for (const payload of [{}, { stripe_user_id: 'acct_other' }]) {
      mock.restoreAll();
      mock.method(globalThis, 'fetch', async () => Response.json(payload));
      assert.equal(await revokeConnectorToken(
        'stripe', { access_token: 'token', stripe_user_id: 'acct_in_token' }, 'acct_claimed',
      ), false);
    }
  });

  it('rejects a TikTok error encoded in a successful HTTP response', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({
      error: { code: 'access_token_invalid', message: 'private provider detail' },
    }));
    assert.equal(await revokeConnectorToken('tiktok', { access_token: 'token' }), false);
  });

  it('treats Google invalid_token as an already-gone grant', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json(
      { error: 'invalid_token' }, { status: 400 },
    ));
    assert.equal(await revokeConnectorToken('youtube', { access_token: 'token' }), true);
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => Response.json(
      { error: 'invalid_request' }, { status: 400 },
    ));
    assert.equal(await revokeConnectorToken('youtube', { access_token: 'token' }), false);
  });

  it('fails malformed and oversized provider rejections without retrying', async () => {
    configureOauthTestEnv();
    for (const response of [
      new Response('<html>error</html>', { status: 400 }),
      new Response('{}', { status: 400, headers: { 'content-length': '16385' } }),
    ]) {
      mock.restoreAll();
      const fetchMock = mock.method(globalThis, 'fetch', async () => response);
      assert.deepEqual(await revokeConnectorTokenDetailed(
        'slack', { access_token: 'token' },
      ), { revoked: false, retryable: false, code: 'provider_rejected' });
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(response.body?.locked, false);
    }
  });

  it('rejects undocumented successful statuses for Google and QuickBooks', async () => {
    configureOauthTestEnv();
    for (const provider of ['youtube', 'quickbooks-online'] as const) {
      mock.restoreAll();
      const response = new Response('{}', { status: 201 });
      const fetchMock = mock.method(globalThis, 'fetch', async () => response);
      assert.equal(await revokeConnectorToken(provider, {
        access_token: 'token', refresh_token: 'refresh',
      }), false);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.equal(response.body?.locked, false);
    }
  });
});
