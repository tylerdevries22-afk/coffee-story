import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import {
  ConnectorIdentityError,
  verifyConnectorCleanupIdentity,
  verifyConnectorIdentity,
} from './connector-oauth-identity';

afterEach(() => mock.restoreAll());

describe('connector OAuth identity integrity', { concurrency: false }, () => {
  it('requires QuickBooks CompanyInfo.Id to match the callback realm', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      CompanyInfo: { Id: '98765', CompanyName: 'Wrong company' },
    }));
    for (const verify of [verifyConnectorIdentity, verifyConnectorCleanupIdentity]) {
      await assert.rejects(
        verify('quickbooks-online', { access_token: 'access-token' }, '12345'),
        ConnectorIdentityError,
      );
    }
  });

  it('requires the TikTok profile to match the issued open_id', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      data: { user: { open_id: 'different-user', display_name: 'Wrong user' } },
    }));
    await assert.rejects(verifyConnectorIdentity('tiktok', {
      access_token: 'access-token', refresh_token: 'refresh-token', open_id: 'issued-user',
    }, null), ConnectorIdentityError);
  });

  it('lets a quarantined partial TikTok token resolve its authenticated owner', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({
      data: { user: { open_id: 'resolved-user', display_name: 'Coffee Story' } },
    }));
    assert.deepEqual(await verifyConnectorCleanupIdentity(
      'tiktok', { access_token: 'access-token' }, null,
    ), { accountId: 'resolved-user', accountLabel: 'Coffee Story' });
  });

  it('resolves cleanup grant identities without optional display labels', async () => {
    let response: unknown = { sub: 'google-subject' };
    mock.method(globalThis, 'fetch', async () => Response.json(response));
    assert.deepEqual(await verifyConnectorCleanupIdentity(
      'youtube', { access_token: 'access-token' }, null,
    ), { accountId: 'google-subject', accountLabel: 'google-subject' });
    response = { ok: true, team_id: 'T1' };
    assert.deepEqual(await verifyConnectorCleanupIdentity(
      'slack', { access_token: 'access-token' }, null,
    ), { accountId: 'T1', accountLabel: 'T1' });
  });

  it('classifies Slack semantic transients separately from proved-invalid credentials', async () => {
    let response: unknown = { ok: false, error: 'service_unavailable' };
    mock.method(globalThis, 'fetch', async () => Response.json(response));
    await assert.rejects(
      verifyConnectorCleanupIdentity('slack', { access_token: 'access-token' }, null),
      (error: unknown) => error instanceof ConnectorIdentityError
        && error.code === 'provider_unavailable' && error.retryable,
    );
    response = { ok: false, error: 'token_revoked' };
    await assert.rejects(
      verifyConnectorCleanupIdentity('slack', { access_token: 'access-token' }, null),
      (error: unknown) => error instanceof ConnectorIdentityError
        && error.code === 'credential_invalid' && !error.retryable,
    );
  });

  it('marks incomplete cleanup identity payloads retryable', async () => {
    mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
    await assert.rejects(
      verifyConnectorCleanupIdentity('slack', { access_token: 'access-token' }, null),
      (error: unknown) => error instanceof ConnectorIdentityError
        && error.code === 'payload' && error.retryable,
    );
  });
});
