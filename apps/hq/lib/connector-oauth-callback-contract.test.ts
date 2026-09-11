import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  boundedConnectorScopes,
  callbackCredential,
  compensationCredential,
  ConnectorScopeError,
  connectorTokenExpiryAt,
} from './connector-oauth-callback-contract';
import { ConnectorExchangeError } from './connector-oauth-exchange';

const NOW = new Date('2026-09-08T12:00:00Z');

describe('connector OAuth callback contracts', () => {
  it('keeps an oversized completion credential inside the cleanup envelope', () => {
    const token = {
      access_token: 'a'.repeat(16_384), refresh_token: 'r'.repeat(4_000), expires_in: 3_600,
    };
    assert.throws(() => callbackCredential(token, 'account-1', NOW), ConnectorExchangeError);
    const retained = compensationCredential(token, 'account-1', NOW);
    assert.ok(retained);
    assert.equal(retained.external_account_id, 'account-1');
    assert.equal(retained.access_token, token.access_token);
  });

  it('measures granted scopes by count and UTF-8 bytes', () => {
    const maximum = Array.from({ length: 32 }, (_value, index) => `scope-${index}`);
    assert.deepEqual(boundedConnectorScopes([...maximum, maximum[0] ?? '']), maximum);
    assert.throws(() => boundedConnectorScopes([...maximum, 'extra']), ConnectorScopeError);
    assert.throws(() => boundedConnectorScopes(['界'.repeat(171)]), ConnectorScopeError);
    assert.deepEqual(boundedConnectorScopes(['界'.repeat(170)]), ['界'.repeat(170)]);
  });

  it('requires bounded safe-integer expiry for managed and Meta credentials', () => {
    assert.throws(() => connectorTokenExpiryAt('slack', { expires_in: 0.5 }, NOW));
    assert.throws(() => connectorTokenExpiryAt('slack', { expires_in: 0 }, NOW));
    assert.equal(connectorTokenExpiryAt(
      'slack', { expires_in: 30 * 24 * 60 * 60 }, NOW,
    ), '2026-10-08T12:00:00.000Z');
    assert.equal(connectorTokenExpiryAt(
      'meta-business-suite', { expires_in: 60 * 24 * 60 * 60 }, NOW,
    ), '2026-11-07T12:00:00.000Z');
    assert.throws(() => connectorTokenExpiryAt(
      'meta-business-suite', { expires_in: 90 * 24 * 60 * 60 + 1 }, NOW,
    ));
  });
});
