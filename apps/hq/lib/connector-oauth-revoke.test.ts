import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { revokeConnectorToken } from './connector-oauth-revoke';
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
    assert.equal(fetchMock.mock.callCount(), 8);
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
    assert.equal(bodyOf(quickbooks).get('token'), 'issued-refresh');
    assert.equal(new Headers(quickbooks.headers).get('authorization'),
      `Basic ${Buffer.from('quickbooks-client:quickbooks-secret').toString('base64')}`);

    const [, slack] = callFor(fetchMock.mock.calls, 'slack.com/api/auth.revoke');
    assert.equal(new Headers(slack.headers).get('authorization'), 'Bearer issued-refresh');
    assert.deepEqual(fetchMock.mock.calls
      .filter((call) => String(call.arguments[0]).includes('slack.com/api/auth.revoke'))
      .map((call) => new Headers((call.arguments[1] as RequestInit).headers).get('authorization')),
    ['Bearer issued-refresh', 'Bearer issued-access']);
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
    mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 503 : 200 });
    });
    assert.equal(await revokeConnectorToken('tiktok', { access_token: 'token' }), true);
    assert.equal(calls, 2);
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
    mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, revoked: false }));
    assert.equal(await revokeConnectorToken('slack', { access_token: 'token' }), false);
  });
});
