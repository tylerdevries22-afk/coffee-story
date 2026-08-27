import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadConnectorCards, loadIntegrationActivity } from './integration-data';

describe('loadConnectorCards', () => {
  it('returns the truthful catalog when no hosted client is configured', async () => {
    const cards = await loadConnectorCards(null);

    assert.ok(cards.length >= 20);
    assert.equal(cards.some((card) => card.isConnected), false);
  });
});

describe('loadIntegrationActivity', () => {
  it('returns an explicit empty history before hosted storage is configured', async () => {
    assert.deepEqual(await loadIntegrationActivity(null), []);
  });
});
