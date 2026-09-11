import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ConnectorExchangeError,
  exchangeConnectorCode,
} from './connector-oauth-providers';
import {
  configureOauthTestEnv,
  restoreOauthTestEnv,
  stalledJsonResponse,
} from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

const CALLBACK = 'https://hq.example.com/cb';
const VERIFIER = 'v'.repeat(43);

describe('connector OAuth code exchange', { concurrency: false }, () => {
  it('exchanges the Meta code over GET', async () => {
    configureOauthTestEnv();
    let call = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      call += 1;
      return call === 1 ? Response.json({ access_token: 'short-meta-token' })
        : Response.json({ access_token: 'long-meta-token', expires_in: 5_184_000 });
    });
    const token = await exchangeConnectorCode(
      'meta-business-suite', 'one-time-code', VERIFIER, CALLBACK,
    );
    assert.equal(token.access_token, 'long-meta-token');
    const [target, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.equal((init as RequestInit | undefined)?.method, undefined);
    assert.match(String(target), /^https:\/\/graph\.facebook\.com\/v25\.0\/oauth\/access_token\?/);
    assert.match(String(target), /client_secret=meta-secret/);
    const extendedTarget = String(fetchMock.mock.calls[1]?.arguments[0]);
    assert.match(extendedTarget, /grant_type=fb_exchange_token/u);
    assert.match(extendedTarget, /fb_exchange_token=short-meta-token/u);
  });

  it('retries once after an explicit throttling response', async () => {
    configureOauthTestEnv();
    for (const key of ['stripe', 'tiktok'] as const) {
      mock.restoreAll();
      let calls = 0;
      const fetchMock = mock.method(globalThis, 'fetch', async () => {
        calls += 1;
        return calls === 1
          ? new Response('{}', { status: 429 })
          : Response.json(key === 'tiktok' ? { data: {
            access_token: `${key}-token`, refresh_token: `${key}-refresh`,
            expires_in: 86_400, refresh_expires_in: 31_536_000, token_type: 'Bearer',
            open_id: 'tiktok-user',
          } } : { access_token: `${key}-token` });
      });
      const token = await exchangeConnectorCode(key, 'one-time-code', VERIFIER, CALLBACK);
      assert.equal(token.access_token, `${key}-token`);
      assert.equal(fetchMock.mock.callCount(), 2);
    }
  });

  it('does not replay a code after a bare gateway failure', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      new Response('{}', { status: 502 }));
    await assert.rejects(exchangeConnectorCode(
      'youtube', 'one-time-code', VERIFIER, CALLBACK,
    ), (error: unknown) => error instanceof ConnectorExchangeError
      && error.stage === 'provider' && error.status === 502);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('retries only a provable pre-delivery transport failure', async () => {
    configureOauthTestEnv();
    let calls = 0;
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      }
      return Response.json({ access_token: 'delivered-after-dns-recovery',
        refresh_token: 'durable-refresh-token', expires_in: 3_600 });
    });
    const token = await exchangeConnectorCode(
      'youtube', 'one-time-code', VERIFIER, CALLBACK,
    );
    assert.equal(token.access_token, 'delivered-after-dns-recovery');
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('does not replay an ambiguous transport failure', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    });
    await assert.rejects(
      exchangeConnectorCode('youtube', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => error instanceof ConnectorExchangeError
        && error.stage === 'transport',
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('keeps the one-attempt deadline active while reading the token body', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async (
      _target: string | URL | Request, init?: RequestInit,
    ) =>
      stalledJsonResponse(init?.signal));
    await assert.rejects(
      exchangeConnectorCode('tiktok', 'one-time-code', VERIFIER, CALLBACK, 5),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.equal(error.stage, 'transport');
        assert.match(error.message, /did not answer in time/u);
        return true;
      },
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('rejects a declared oversized token body without replaying the code', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{"ok":true}', {
      headers: { 'content-length': '20001', 'content-type': 'application/json' },
    }));
    await assert.rejects(
      exchangeConnectorCode('youtube', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.equal(error.stage, 'payload');
        assert.match(error.message, /oversized/u);
        return true;
      },
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('bounds retries for a non-JSON transient failure without leaking secrets', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('<html>throttled</html>', {
      status: 429, headers: { 'content-type': 'text/html' },
    }));
    await assert.rejects(
      exchangeConnectorCode('tiktok', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.equal(error.stage, 'payload');
        assert.equal(error.status, 429);
        assert.ok(!error.message.includes('one-time-code'));
        assert.ok(!error.message.includes('tiktok-secret'));
        return true;
      },
    );
    assert.equal(fetchMock.mock.callCount(), 2);
  });

  it('does not include untrusted provider error text in a rejected exchange', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json(
      { error: 'invalid_client', error_description: 'client secret mismatch' }, { status: 400 },
    ));
    await assert.rejects(
      exchangeConnectorCode('youtube', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.equal(error.stage, 'provider');
        assert.match(error.message, /provider rejected/u);
        assert.ok(!error.message.includes('client secret mismatch'));
        assert.ok(!error.message.includes('invalid_client'));
        return true;
      },
    );
  });

  it('accepts TikTok tokens nested under data', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ data: { access_token: 'tiktok-token', refresh_token: 'tiktok-refresh',
        expires_in: 86_400, refresh_expires_in: 31_536_000,
        token_type: 'Bearer', open_id: 'creator-1' } }));
    const token = await exchangeConnectorCode('tiktok', 'one-time-code', VERIFIER, CALLBACK);
    assert.equal(token.access_token, 'tiktok-token');
  });

  it('signs Stripe with Basic auth and omits the form secret', async () => {
    process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_client';
    process.env.STRIPE_SECRET_KEY = 'sk_secret';
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      Response.json({ access_token: 'stripe-token' }));
    await exchangeConnectorCode('stripe', 'one-time-code', VERIFIER, CALLBACK);
    const [, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Basic ${Buffer.from('sk_secret:').toString('base64')}`);
    assert.ok(!String((init as RequestInit | undefined)?.body).includes('client_secret'));
  });
});
