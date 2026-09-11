import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ConnectorExchangeError,
  exchangeConnectorCode,
} from './connector-oauth-exchange';
import {
  configureOauthTestEnv,
  restoreOauthTestEnv,
} from './connector-oauth-test-helpers';

const CALLBACK = 'https://hq.example.test/callback';
const VERIFIER = 'v'.repeat(43);

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth issued-credential custody', { concurrency: false }, () => {
  it('preserves the bounded Meta short token when extension fails', async () => {
    configureOauthTestEnv();
    let call = 0;
    mock.method(globalThis, 'fetch', async () => {
      call += 1;
      return call === 1
        ? Response.json({ access_token: 'short-meta-token', expires_in: 3_600 })
        : new Response('{}', { status: 502 });
    });
    await assert.rejects(
      exchangeConnectorCode('meta-business-suite', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.equal(error.stage, 'provider');
        assert.deepEqual(error.issuedCredential, {
          access_token: 'short-meta-token', expires_in: 3_600,
        });
        assert.ok(!error.message.includes('short-meta-token'));
        assert.ok(!JSON.stringify(error).includes('short-meta-token'));
        return true;
      },
    );
  });

  it('preserves a bounded issued token when the managed tuple is incomplete', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({
      access_token: 'issued-access-token', expires_in: 3_600,
    }));
    await assert.rejects(
      exchangeConnectorCode('youtube', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => {
        assert.ok(error instanceof ConnectorExchangeError);
        assert.deepEqual(error.issuedCredential, {
          access_token: 'issued-access-token', expires_in: 3_600,
        });
        return true;
      },
    );
  });

  it('rejects a Slack HTTP success whose semantic result is failure', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({
      ok: false, error: 'invalid_auth', access_token: 'issued-access-token',
      refresh_token: 'issued-refresh-token', expires_in: 3_600,
    }));
    await assert.rejects(
      exchangeConnectorCode('slack', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => error instanceof ConnectorExchangeError
        && error.stage === 'provider'
        && error.issuedCredential?.access_token === 'issued-access-token',
    );
  });

  it('never replays semantic transient responses that already issued a credential', async () => {
    configureOauthTestEnv();
    for (const code of ['server_error', 'temporarily_unavailable'] as const) {
      mock.restoreAll();
      const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({
        ok: false, error: code, access_token: 'issued-access-token',
        refresh_token: 'issued-refresh-token', expires_in: 3_600,
      }));
      await assert.rejects(
        exchangeConnectorCode('slack', 'one-time-code', VERIFIER, CALLBACK),
        (error: unknown) => error instanceof ConnectorExchangeError
          && error.issuedCredential?.access_token === 'issued-access-token',
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    }
  });

  it('normalizes a scalar Slack response into a structured provider error', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json('unexpected'));
    await assert.rejects(
      exchangeConnectorCode('slack', 'one-time-code', VERIFIER, CALLBACK),
      (error: unknown) => error instanceof ConnectorExchangeError
        && error.stage === 'provider' && error.issuedCredential === null,
    );
  });
});
