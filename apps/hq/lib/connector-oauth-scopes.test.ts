import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { resolveGrantedScopes } from './connector-oauth-providers';
import {
  configureOauthTestEnv,
  oversizedJsonResponse,
  restoreOauthTestEnv,
  stalledJsonResponse,
} from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth granted scopes', { concurrency: false }, () => {
  it('asks Meta which permissions were actually granted', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({ data: [
      { permission: 'pages_show_list', status: 'granted' },
      { permission: 'ads_read', status: 'declined' },
      { permission: 'read_insights', status: 'granted' },
    ] }));
    const granted = await resolveGrantedScopes('meta-business-suite', { access_token: 'meta-token' });
    assert.ok(granted);
    assert.deepEqual([...granted].sort(), ['pages_show_list', 'read_insights']);
    assert.ok(!granted.includes('ads_read'));
  });

  it('returns unknown after a bounded stalled Meta permissions body', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async (_target, init) =>
      stalledJsonResponse(init?.signal));
    assert.equal(await resolveGrantedScopes(
      'meta-business-suite', { access_token: 'meta-token' }, { timeoutMs: 5, retryDelayMs: 0 },
    ), null);
    assert.equal(fetchMock.mock.callCount(), 2, 'the read-only verification uses bounded retry');
  });

  it('returns unknown for oversized permissions without retrying', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => oversizedJsonResponse());
    assert.equal(await resolveGrantedScopes(
      'meta-business-suite', { access_token: 'meta-token' },
    ), null);
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('keeps unreachable and genuinely empty Meta grants distinct', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 500 }));
    assert.equal(await resolveGrantedScopes('meta-business-suite', { access_token: 't' }), null);
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => Response.json({ data: [] }));
    assert.deepEqual(await resolveGrantedScopes('meta-business-suite', { access_token: 't' }), []);
  });

  it('does not assume requests for providers that normally report scope', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    for (const key of ['tiktok', 'slack', 'youtube', 'stripe', 'google-suite'] as const) {
      assert.equal(await resolveGrantedScopes(key, { access_token: 't' }), null);
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('accepts the requested scope for QuickBooks when the response omits it', async () => {
    process.env.QUICKBOOKS_CLIENT_ID = 'qb-client';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'qb-secret';
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    assert.deepEqual(
      await resolveGrantedScopes('quickbooks-online', { access_token: 'qb-token' }),
      ['com.intuit.quickbooks.accounting'],
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('drops carried-over Google scopes this connector did not request', async () => {
    configureOauthTestEnv();
    const granted = await resolveGrantedScopes('google-suite', {
      access_token: 't',
      scope: 'openid email https://www.googleapis.com/auth/drive.file'
        + ' https://www.googleapis.com/auth/business.manage'
        + ' https://www.googleapis.com/auth/adwords',
    });
    assert.ok(granted);
    assert.deepEqual([...granted].sort(), [
      'email', 'https://www.googleapis.com/auth/drive.file', 'openid',
    ]);
  });

  it('narrows a verified Meta grant to the requested scopes', async () => {
    configureOauthTestEnv();
    mock.method(globalThis, 'fetch', async () => Response.json({ data: [
      { permission: 'pages_show_list', status: 'granted' },
      { permission: 'pages_manage_posts', status: 'granted' },
    ] }));
    assert.deepEqual(
      await resolveGrantedScopes('meta-business-suite', { access_token: 't' }),
      ['pages_show_list'],
    );
  });

  it('leaves a provider that requests no scopes untouched', async () => {
    configureOauthTestEnv();
    assert.deepEqual(
      await resolveGrantedScopes('stripe', { access_token: 't', scope: 'read_write' }),
      ['read_write'],
    );
  });

  it('prefers a reported scope over a request-derived scope', async () => {
    process.env.QUICKBOOKS_CLIENT_ID = 'qb-client';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'qb-secret';
    assert.deepEqual(
      await resolveGrantedScopes('quickbooks-online', {
        access_token: 't', scope: 'com.intuit.quickbooks.accounting',
      }),
      ['com.intuit.quickbooks.accounting'],
    );
  });

  it('uses a reported Meta scope without an extra provider call', async () => {
    configureOauthTestEnv();
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({ data: [] }));
    assert.deepEqual(
      await resolveGrantedScopes('meta-business-suite', {
        access_token: 't', scope: 'pages_show_list,ads_read',
      }),
      ['pages_show_list', 'ads_read'],
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});
