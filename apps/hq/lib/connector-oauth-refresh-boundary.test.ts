import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ConnectorRefreshError,
  connectorTokenExpiry,
  refreshConnectorToken,
} from './connector-oauth-refresh';
import { initialConnectorToken } from './connector-oauth-exchange-contract';
import { refreshedConnectorToken } from './connector-oauth-refresh-payload';
import { configureOauthTestEnv, restoreOauthTestEnv } from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

const credential = { access_token: 'old-access', refresh_token: 'old-refresh',
  external_account_id: 'workspace-1' };

describe('refreshConnectorToken boundaries', { concurrency: false }, () => {
  it('fails safely on invalid grants and retries reusable malformed bodies later', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json(
      { error: 'invalid_grant', error_description: 'refresh secret leaked' }, { status: 400 },
    ));
    await assert.rejects(refreshConnectorToken('google-suite', credential), (error: unknown) => {
      assert.ok(error instanceof ConnectorRefreshError);
      assert.equal(error.code, 'invalid_grant');
      assert.equal(error.retryable, false);
      assert.ok(!error.message.includes('refresh secret leaked'));
      return true;
    });
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => new Response('{}', {
      headers: { 'content-length': '20001' },
    }));
    await assert.rejects(refreshConnectorToken('youtube', credential), (error: unknown) =>
      error instanceof ConnectorRefreshError && error.stage === 'payload' && error.retryable);
  });

  it('requires each rotating provider to return a fresh token and bounded lifetime', async () => {
    configureOauthTestEnv();
    for (const provider of ['quickbooks-online', 'slack', 'tiktok'] as const) {
      mock.restoreAll();
      mock.method(globalThis, 'fetch', async () => Response.json({
        ok: true, access_token: 'new-access', expires_in: 3_600,
      }));
      await assert.rejects(refreshConnectorToken(provider, credential), (error: unknown) =>
        error instanceof ConnectorRefreshError && error.stage === 'payload');
    }
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => Response.json({ access_token: 'new-access' }));
    await assert.rejects(refreshConnectorToken('youtube', credential), (error: unknown) =>
      error instanceof ConnectorRefreshError && error.stage === 'payload' && error.retryable);
  });

  it('rejects short tokens and a combined multibyte credential before settlement', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({
      access_token: '1234567', expires_in: 3_600,
    }));
    await assert.rejects(refreshConnectorToken('youtube', credential), ConnectorRefreshError);
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => Response.json({
      access_token: 'new-access', expires_in: 3_600, scope: 'x'.repeat(1_500),
    }));
    await assert.rejects(refreshConnectorToken('youtube', {
      ...credential, metadata: '界'.repeat(6_200),
    }), ConnectorRefreshError);
  });

  it('requires TikTok refresh identity, bearer type, and refresh lifetime', async () => {
    configureOauthTestEnv();
    for (const extra of [
      { token_type: 'Basic', refresh_expires_in: 3_600, open_id: 'workspace-1' },
      { token_type: 'Bearer', open_id: 'workspace-1' },
      { token_type: 'Bearer', refresh_expires_in: 3_600, open_id: 'other-user' },
    ]) {
      mock.restoreAll();
      mock.method(globalThis, 'fetch', async () => Response.json({ data: {
        access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3_600,
        ...extra,
      } }));
      await assert.rejects(refreshConnectorToken('tiktok', credential), (error: unknown) =>
        error instanceof ConnectorRefreshError && error.code === 'rotation_ambiguous');
    }
  });

  it('skips nonrefreshing providers and computes bounded expiry', async () => {
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

  it('requires safe integer lifetimes at the initial provider boundary', () => {
    const base = { access_token: 'new-access', refresh_token: 'new-refresh' };
    assert.equal(initialConnectorToken('youtube', { ...base, expires_in: 0.5 }), null);
    assert.ok(initialConnectorToken('youtube', {
      ...base, expires_in: 30 * 24 * 60 * 60,
    }));
    assert.equal(initialConnectorToken('youtube', {
      ...base, expires_in: 30 * 24 * 60 * 60 + 1,
    }), null);
    const tiktok = { ...base, expires_in: 3_600, token_type: 'Bearer', open_id: 'creator-1' };
    assert.equal(initialConnectorToken('tiktok', {
      ...tiktok, refresh_expires_in: 1.5,
    }), null);
    assert.ok(initialConnectorToken('tiktok', {
      ...tiktok, refresh_expires_in: 2 * 366 * 24 * 60 * 60,
    }));
  });

  it('bounds and degrades explicit provider scope responses', () => {
    const response = { access_token: 'new-access', refresh_token: 'new-refresh',
      expires_in: 3_600 };
    assert.throws(() => refreshedConnectorToken(
      'google-suite', { ...response, scope: false }, credential,
    ), ConnectorRefreshError);
    assert.equal(refreshedConnectorToken(
      'slack', { ...response, scope: false }, credential,
    ).scope, '');
    const maximum = Array.from({ length: 32 }, (_value, index) => `scope-${index}`).join(' ');
    assert.equal(refreshedConnectorToken(
      'slack', { ...response, scope: maximum }, credential,
    ).scope, maximum);
    const excessive = `${maximum} scope-32`;
    assert.equal(refreshedConnectorToken(
      'slack', { ...response, scope: excessive }, credential,
    ).scope, '');
    assert.equal(refreshedConnectorToken(
      'tiktok', { ...response, scope: '界'.repeat(171), token_type: 'Bearer',
        refresh_expires_in: 3_600, open_id: 'workspace-1' }, credential,
    ).scope, '');
  });

  it('rejects a near-limit stable credential before contacting the provider', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    await assert.rejects(refreshConnectorToken('youtube', {
      access_token: 'old-access', refresh_token: 'r'.repeat(16_384),
      external_account_id: 'workspace-1', metadata: 'm'.repeat(3_400),
    }), (error: unknown) => error instanceof ConnectorRefreshError
      && error.code === 'credential_contract_invalid');
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('backs off Slack invalid_auth without replaying it in the same call', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({
      ok: false, error: 'invalid_auth',
    }));
    await assert.rejects(refreshConnectorToken('slack', credential), (error: unknown) =>
      error instanceof ConnectorRefreshError && error.code === 'provider_rejected'
        && error.retryable);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});
