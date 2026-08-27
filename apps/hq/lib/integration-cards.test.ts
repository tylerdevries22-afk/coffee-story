import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  connectorCardsOf,
  defaultConnectorCards,
  filterConnectorCards,
} from './integration-cards';

describe('connectorCardsOf', () => {
  it('shows truthful setup, approval, and uncertified states without installations', () => {
    const cards = defaultConnectorCards();

    assert.equal(cards.find((card) => card.id === 'square')?.status, 'setup-required');
    assert.equal(cards.find((card) => card.id === 'google-suite')?.status, 'provider-approval-required');
    assert.equal(cards.find((card) => card.id === 'twilio')?.canConfigure, true);
    assert.equal(cards.find((card) => card.id === 'sendgrid')?.status, 'setup-required');
    assert.equal(cards.find((card) => card.id === 'sendgrid')?.canConfigure, true);
    assert.equal(cards.find((card) => card.id === 'shopify')?.status, 'uncertified');
  });

  it('maps database underscore states and tenant capability metadata', () => {
    const cards = connectorCardsOf(
      [{ id: 'provider-1', provider_key: 'square', availability: 'available', is_active: true }],
      [{
        id: 'installation-1',
        provider_id: 'provider-1',
        status: 'connected_healthy',
        external_account_label: 'Downtown Square',
        enabled_capabilities: ['payments.read'],
        connected_at: '2026-08-27T18:00:00.000Z',
        last_synced_at: '2026-08-27T19:00:00.000Z',
        updated_at: '2026-08-27T19:00:00.000Z',
      }],
    );
    const square = cards.find((card) => card.id === 'square');

    assert.equal(square?.status, 'connected-healthy');
    assert.equal(square?.isConnected, true);
    assert.equal(square?.accountLabel, 'Downtown Square');
    assert.equal(square?.enabledCapabilityCount, 1);
  });

  it('filters connected and health views without changing catalog ordering', () => {
    const cards = connectorCardsOf(
      [{ id: 'provider-1', provider_key: 'square', availability: 'available', is_active: true }],
      [{
        id: 'installation-1', provider_id: 'provider-1', status: 'connected_degraded',
        external_account_label: '', enabled_capabilities: [], connected_at: null,
        last_synced_at: null, updated_at: '2026-08-27T19:00:00.000Z',
      }],
    );

    assert.deepEqual(filterConnectorCards(cards, 'connected').map((card) => card.id), ['square']);
    assert.deepEqual(filterConnectorCards(cards, 'health').map((card) => card.id), ['square']);
    assert.equal(filterConnectorCards(cards, 'catalog').length, cards.length);
  });
});
