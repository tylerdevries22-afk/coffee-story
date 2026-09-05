import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  connectorCardsOf,
  demoConnectorCards,
  defaultConnectorCards,
  filterConnectorCards,
  selectableConnectorIds,
} from './integration-cards';

describe('connectorCardsOf', () => {
  it('keeps the static catalog visible but fails closed without registry rows', () => {
    const cards = defaultConnectorCards();

    assert.equal(cards.find((card) => card.id === 'square')?.status, 'disabled');
    assert.equal(cards.find((card) => card.id === 'square')?.isInstalled, false);
    assert.ok(cards.length >= 20);
    assert.ok(cards.every((card) => !card.canConfigure));
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
    assert.equal(square?.isInstalled, true);
    assert.equal(square?.accountLabel, 'Downtown Square');
    assert.equal(square?.enabledCapabilityCount, 1);
  });

  it('requires an active, eligible registry row for configuration', () => {
    const cards = connectorCardsOf([
      { id: 'square-id', provider_key: 'square', availability: 'disabled', is_active: true },
      { id: 'stripe-id', provider_key: 'stripe', availability: 'available', is_active: false },
      { id: 'slack-id', provider_key: 'slack', availability: 'uncertified', is_active: true },
      { id: 'twilio-id', provider_key: 'twilio', availability: 'setup_required', is_active: true },
    ], []);

    assert.equal(cards.find((card) => card.id === 'square')?.canConfigure, false);
    assert.equal(cards.find((card) => card.id === 'stripe')?.canConfigure, false);
    assert.equal(cards.find((card) => card.id === 'slack')?.canConfigure, false);
    assert.equal(cards.find((card) => card.id === 'twilio')?.canConfigure, true);
    assert.equal(cards.find((card) => card.id === 'resend')?.canConfigure, false);
  });

  it('removes missing and disabled providers from submitted selections', () => {
    const cards = connectorCardsOf([
      { id: 'square-id', provider_key: 'square', availability: 'available', is_active: true },
      { id: 'stripe-id', provider_key: 'stripe', availability: 'disabled', is_active: true },
    ], []);

    assert.deepEqual(selectableConnectorIds(cards, ['square', 'stripe', 'resend', 'square']), ['square']);
  });

  it('keeps an existing disabled installation visible for management', () => {
    const cards = connectorCardsOf(
      [{ id: 'provider-1', provider_key: 'square', availability: 'disabled', is_active: false }],
      [{
        id: 'installation-1', provider_id: 'provider-1', status: 'connected_degraded',
        external_account_label: 'Legacy Square', enabled_capabilities: [], connected_at: null,
        last_synced_at: null, updated_at: '2026-08-27T19:00:00.000Z',
      }],
    );
    const square = cards.find((card) => card.id === 'square');

    assert.equal(square?.isInstalled, true);
    assert.equal(square?.isConnected, true);
    assert.equal(square?.canConfigure, false);
  });

  it('reflects onboarding MCP selections in the infrastructure-free demo', () => {
    const cards = demoConnectorCards(['square', 'google-suite']);
    assert.equal(cards.find((card) => card.id === 'square')?.isInstalled, true);
    assert.equal(cards.find((card) => card.id === 'square')?.status, 'setup-required');
    assert.equal(cards.find((card) => card.id === 'google-suite')?.status, 'provider-approval-required');
    assert.equal(cards.find((card) => card.id === 'stripe')?.isInstalled, false);
    assert.equal(cards.find((card) => card.id === 'shopify')?.status, 'uncertified');
    assert.equal(cards.find((card) => card.id === 'shopify')?.canConfigure, false);
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
