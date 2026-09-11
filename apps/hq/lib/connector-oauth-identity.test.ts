import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { ExternalRequestError } from '@platform/engine';

import { verifyConnectorIdentity } from './connector-oauth-providers';
import {
  oversizedJsonResponse,
  restoreOauthTestEnv,
  stalledJsonResponse,
} from './connector-oauth-test-helpers';

afterEach(() => {
  mock.restoreAll();
  restoreOauthTestEnv();
});

describe('connector OAuth identity verification', { concurrency: false }, () => {
  it('keeps its deadline active through a stalled identity body', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async (_target: RequestInfo | URL, init?: RequestInit) =>
      stalledJsonResponse(init?.signal));
    await assert.rejects(
      verifyConnectorIdentity(
        'youtube', { access_token: 'access-token' }, null, { timeoutMs: 5, retryDelayMs: 0 },
      ),
      (error: unknown) => error instanceof ExternalRequestError && error.code === 'timeout',
    );
    assert.equal(fetchMock.mock.callCount(), 2, 'read-only identity verification is retried');
  });

  it('rejects an oversized identity without retrying', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => oversizedJsonResponse());
    await assert.rejects(
      verifyConnectorIdentity('youtube', { access_token: 'access-token' }, null),
      (error: unknown) => error instanceof ExternalRequestError
        && error.code === 'response_too_large',
    );
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  it('bounds and normalizes provider-supplied account labels', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      id: '10000000000', name: `  ${'n'.repeat(4_000)}  `,
    }));
    const identity = await verifyConnectorIdentity(
      'meta-business-suite', { access_token: 'access-token' }, null,
    );
    assert.equal(identity.accountLabel.length, 160);
    assert.equal(identity.accountLabel.trim(), identity.accountLabel);

    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => Response.json({
      id: 'acct_1', display_name: '\n\n  Coffee   Story \t',
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('stripe', { access_token: 'access-token' }, null),
      { accountId: 'acct_1', accountLabel: 'Coffee Story' },
    );
  });

  it('identifies the YouTube channel rather than the signed-in person', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      items: [{ id: 'UC_channel', snippet: { title: 'Coffee Story' } }],
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('youtube', { access_token: 'access-token' }, null),
      { accountId: 'UC_channel', accountLabel: 'Coffee Story' },
    );
  });

  it('identifies a TikTok creator from the nested user payload', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      data: { user: { open_id: 'creator-1', display_name: 'Coffee Story' } },
    }));
    assert.deepEqual(
      await verifyConnectorIdentity('tiktok', { access_token: 'access-token' }, null),
      { accountId: 'creator-1', accountLabel: 'Coffee Story' },
    );
  });

  it('identifies the Meta business user behind the grant', async () => {
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ id: '10000000000', name: 'Coffee Story HQ' }));
    assert.deepEqual(
      await verifyConnectorIdentity('meta-business-suite', { access_token: 'access-token' }, null),
      { accountId: '10000000000', accountLabel: 'Coffee Story HQ' },
    );
  });

  it('falls back to a Stripe account id when its display name is absent', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ id: 'acct_1', display_name: 'Coffee Story' }));
    assert.deepEqual(
      await verifyConnectorIdentity('stripe', { access_token: 'access-token' }, null),
      { accountId: 'acct_1', accountLabel: 'Coffee Story' },
    );
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => Response.json({ id: 'acct_2' }));
    assert.deepEqual(
      await verifyConnectorIdentity('stripe', { access_token: 'access-token' }, null),
      { accountId: 'acct_2', accountLabel: 'acct_2' },
    );
  });

  it('trusts a Slack identity only when the payload reports ok', async () => {
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: true, team_id: 'T1', team: 'Coffee Story' }));
    assert.deepEqual(
      await verifyConnectorIdentity('slack', { access_token: 'access-token' }, null),
      { accountId: 'T1', accountLabel: 'Coffee Story' },
    );
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () =>
      Response.json({ ok: false, team_id: 'T1', team: 'Coffee Story' }));
    await assert.rejects(
      verifyConnectorIdentity('slack', { access_token: 'access-token' }, null),
      /identity verification failed/i,
    );
  });

  it('rejects an invalid QuickBooks realm without dialing it', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    await assert.rejects(
      verifyConnectorIdentity('quickbooks-online', { access_token: 'access-token' }, '9341; drop'),
      /identity verification failed/i,
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('rejects a grant whose identity has no usable account', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ items: [] }));
    await assert.rejects(
      verifyConnectorIdentity('youtube', { access_token: 'access-token' }, null),
      /identity verification failed/i,
    );
  });
});
