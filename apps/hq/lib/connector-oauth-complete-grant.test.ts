import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasCompleteConnectorGrant } from './connector-oauth-scopes';

describe('hasCompleteConnectorGrant', () => {
  it('rejects a partial provider grant', () => {
    process.env.META_APP_ID = 'meta-id';
    process.env.META_APP_SECRET = 'meta-secret';
    assert.equal(hasCompleteConnectorGrant('meta-business-suite', ['public_profile']), false);
  });

  it('accepts every requested scope independent of provider order', () => {
    process.env.SLACK_CLIENT_ID = 'slack-id';
    process.env.SLACK_CLIENT_SECRET = 'slack-secret';
    assert.equal(hasCompleteConnectorGrant('slack', ['chat:write', 'channels:read']), true);
  });

  it('accepts scope-free connector contracts', () => {
    process.env.STRIPE_CONNECT_CLIENT_ID = 'stripe-id';
    process.env.STRIPE_SECRET_KEY = 'stripe-secret';
    assert.equal(hasCompleteConnectorGrant('stripe', []), true);
  });
});
