import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { squareConnectionStatus } from './square-oauth-contract';
import {
  demoSquareConnectionStatuses,
  loadSquareConnectionStatusQuery,
  squareLocationUiStatus,
} from './square-connection-status-result';

describe('squareConnectionStatus', () => {
  it('requires renewed consent for legacy grants', () => {
    assert.equal(squareConnectionStatus(1), 'reauthorization-required');
  });

  it('accepts current and later compatible scope contracts', () => {
    assert.equal(squareConnectionStatus(2), 'connected');
    assert.equal(squareConnectionStatus(3), 'connected');
  });

  it('preserves connected fixtures only for an unconfigured demo', () => {
    assert.equal(squareLocationUiStatus(demoSquareConnectionStatuses(), 'shop', true), 'connected');
  });

  it('fails closed when the live contract-version query fails', async () => {
    for (const query of [
      async () => ({ data: null, error: { message: 'missing column' } }),
      async (): Promise<never> => { throw new Error('network failed'); },
    ]) {
      const loaded = await loadSquareConnectionStatusQuery(query);
      assert.equal(loaded.source, 'unavailable');
      assert.equal(
        squareLocationUiStatus(loaded, 'shop', true),
        'reauthorization-required',
      );
    }
  });

  it('uses the returned live scope contract instead of fixture connectivity', async () => {
    const loaded = await loadSquareConnectionStatusQuery(async () => ({
      data: [{ location_id: 'shop', oauth_scope_contract_version: 1 }], error: null,
    }));
    assert.equal(squareLocationUiStatus(loaded, 'shop', true), 'reauthorization-required');
  });
});
