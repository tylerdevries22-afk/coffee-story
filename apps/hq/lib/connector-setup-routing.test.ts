import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { listConnectorCatalog } from '@platform/integrations';

import type { ConnectorCertificationRow } from './connector-auth-readiness';
import { defaultConnectorCards } from './integration-cards';
import { OAUTH_CONNECTOR_KEYS } from './connector-oauth-config';
import {
  activeRegistry,
  cardsById,
  certifiedOAuthProviders,
  configureEverything,
  OAUTH_IDS,
  restoreConnectorTestEnvironment,
} from './connector-setup-routing-test-helpers';

afterEach(restoreConnectorTestEnvironment);

describe('connector setup routing', { concurrency: false }, () => {
  it('publishes a redirect path only for a provider this app actually routes', () => {
    const served = new Set<string>([
      ...OAUTH_CONNECTOR_KEYS.map((key) => `/api/connectors/${key}/callback`),
      '/api/square/callback',
    ]);
    const published = listConnectorCatalog()
      .filter((entry) => entry.setup.redirectPath !== undefined)
      .map((entry) => ({ id: entry.descriptor.id, path: entry.setup.redirectPath }));
    assert.ok(published.length > 0);
    for (const { id, path } of published) {
      assert.ok(path !== undefined && served.has(path), `${id} publishes an unrouted path`);
    }
    for (const key of OAUTH_CONNECTOR_KEYS) {
      assert.ok(published.some((entry) => entry.id === key), `${key} publishes no redirect`);
    }
  });

  it('gives every connectable card its declared setup block', () => {
    for (const card of defaultConnectorCards()) {
      if (card.availability === 'coming-soon') continue;
      assert.ok(card.setup.steps.length > 0, `${card.id} lost its setup steps`);
      assert.match(card.setup.consoleUrl ?? '', /^https:\/\//u);
    }
  });

  it('links an OAuth provider only after every gate succeeds', () => {
    configureEverything();
    const cards = cardsById([...OAUTH_IDS]);
    for (const id of OAUTH_IDS) {
      assert.equal(cards.get(id)?.connectHref, `/api/connectors/${id}/authorize`);
      assert.equal(cards.get(id)?.connectLabel, 'Connect');
    }
  });

  it('withholds links without certification', () => {
    configureEverything();
    for (const id of OAUTH_IDS) assert.equal(cardsById().get(id)?.connectHref, null);
  });

  it('withholds links without a strong state secret', () => {
    configureEverything();
    delete process.env.CONNECTOR_OAUTH_STATE_SECRET;
    for (const id of OAUTH_IDS) {
      assert.equal(cardsById([...OAUTH_IDS]).get(id)?.connectHref, null);
    }
    process.env.CONNECTOR_OAUTH_STATE_SECRET = 'short';
    for (const id of OAUTH_IDS) {
      assert.equal(cardsById([...OAUTH_IDS]).get(id)?.connectHref, null);
    }
  });

  it('withholds only the provider missing its credentials', () => {
    configureEverything();
    delete process.env.TIKTOK_CLIENT_SECRET;
    const cards = cardsById([...OAUTH_IDS]);
    assert.equal(cards.get('tiktok')?.connectHref, null);
    assert.equal(cards.get('youtube')?.connectHref, '/api/connectors/youtube/authorize');
  });

  it('obeys the registry activation kill switch', () => {
    configureEverything();
    const card = cardsById([...OAUTH_IDS], { youtube: { is_active: false } }).get('youtube');
    assert.equal(card?.canConfigure, false);
    assert.equal(card?.connectHref, null);
    assert.equal(card?.statusLabel, 'Disabled');
  });

  it('fails closed on an unknown registry availability', () => {
    const card = cardsById([], { slack: { availability: 'retired' } }).get('slack');
    assert.equal(card?.canConfigure, false);
    assert.equal(card?.statusLabel, 'Disabled');
  });

  it('drops deactivated providers from the certified set', () => {
    const registry = [
      { id: 'p1', provider_key: 'youtube', availability: 'available', is_active: false },
      { id: 'p2', provider_key: 'tiktok', availability: 'disabled', is_active: true },
      { id: 'p3', provider_key: 'slack', availability: 'available', is_active: true },
    ];
    const capabilities = registry.map((row) => ({
      id: `${row.id}-cap`, provider_id: row.id, oauth_scopes: [] as readonly string[],
    }));
    const certifications = capabilities.map((capability) => ({
      capability_id: capability.id, environment: 'sandbox', status: 'passed',
      certified_at: '2026-01-01T00:00:00.000Z', valid_until: null,
    }));
    const certified = certifiedOAuthProviders(registry, capabilities, certifications);
    assert.equal(certified.has('youtube'), false);
    assert.equal(certified.has('tiktok'), false);
    assert.equal(certified.has('slack'), true);
  });

  it('requires a current, dated sandbox certification', () => {
    const registry = [{ id: 'p1', provider_key: 'slack', availability: 'available', is_active: true }];
    const capabilities = [{ id: 'cap', provider_id: 'p1', oauth_scopes: [] as readonly string[] }];
    const base: ConnectorCertificationRow = {
      capability_id: 'cap', environment: 'sandbox', status: 'passed',
      certified_at: '2026-01-01T00:00:00.000Z', valid_until: null,
    };
    const certifies = (row: ConnectorCertificationRow) =>
      certifiedOAuthProviders(registry, capabilities, [row], Date.parse('2026-09-07')).has('slack');
    assert.equal(certifies(base), true);
    assert.equal(certifies({ ...base, environment: 'production' }), false);
    assert.equal(certifies({ ...base, status: 'failed' }), false);
    assert.equal(certifies({ ...base, certified_at: null }), false);
    assert.equal(certifies({ ...base, valid_until: '2026-09-01T00:00:00Z' }), false);
    assert.equal(certifies({ ...base, valid_until: '2026-12-01T00:00:00Z' }), true);
  });

  it('keeps the active registry helper aligned with the catalog', () => {
    assert.ok(activeRegistry().length > 0);
  });
});
