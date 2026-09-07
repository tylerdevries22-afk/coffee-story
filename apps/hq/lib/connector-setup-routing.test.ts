import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { listConnectorCatalog } from '@platform/integrations';

import { connectorCardsOf, defaultConnectorCards, demoConnectorCards } from './integration-cards';
import { withConnectorAuthorization } from './connector-auth-readiness';

const ENV = [
  'CONNECTOR_OAUTH_STATE_SECRET', 'CONNECTOR_PUBLIC_ORIGIN',
  'SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_TOKEN_KEY',
] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

/** Mirrors an activated registry: every non-planned provider live for the tenant. */
function activeRegistry() {
  return listConnectorCatalog()
    .filter((entry) => entry.availability !== 'coming-soon')
    .map((entry) => ({
      id: entry.descriptor.id,
      provider_key: entry.descriptor.id,
      availability: entry.availability.replaceAll('-', '_'),
      is_active: true,
    }));
}

function cardsById() {
  const cards = withConnectorAuthorization(connectorCardsOf(activeRegistry(), []));
  return new Map(cards.map((card) => [card.id, card]));
}

afterEach(() => {
  for (const name of ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('connector setup routing', { concurrency: false }, () => {
  it('gives every catalog card the setup block its provider declares', () => {
    for (const card of defaultConnectorCards()) {
      assert.ok(card.setup.steps.length > 0, `${card.id} lost its setup steps`);
      assert.match(card.setup.consoleUrl, /^https:\/\//u);
    }
  });

  it('sends an API-key provider to its detail page, never to an OAuth redirect', () => {
    const cards = cardsById();
    for (const id of ['transistor', 'beehiiv']) {
      const card = cards.get(id);
      assert.equal(card?.connectHref, `/integrations/${id}`, `${id} routes to its detail page`);
      assert.equal(card?.connectLabel, 'Add API key');
    }
  });

  it('offers a manual-only provider a guided import instead of a dead end', () => {
    const cards = cardsById();
    for (const id of ['kindle-direct-publishing', 'acx-audiobooks']) {
      const card = cards.get(id);
      assert.equal(card?.isManualOnly, true, `${id} is manual only`);
      assert.equal(card?.connectHref, `/integrations/${id}`);
      assert.equal(card?.connectLabel, 'Set up import');
      assert.equal(card?.statusLabel, 'Manual import');
    }
  });

  it('withholds every action when the registry is unavailable', () => {
    const cards = withConnectorAuthorization(defaultConnectorCards());
    assert.ok(cards.length > 0);
    for (const card of cards) {
      assert.equal(card.connectHref, null, `${card.id} must fail closed`);
      assert.equal(card.canConfigure, false, `${card.id} must not be configurable`);
    }
  });

  it('still withholds an OAuth link until the provider is certified and configured', () => {
    process.env.CONNECTOR_OAUTH_STATE_SECRET = 's'.repeat(48);
    process.env.CONNECTOR_PUBLIC_ORIGIN = 'https://hq.example.com';
    const cards = cardsById();
    for (const id of ['youtube', 'tiktok', 'meta-business-suite']) {
      assert.equal(cards.get(id)?.connectHref, null, `${id} needs certification first`);
    }
  });

  it('rests a demo manual-only selection at manual import, not setup required', () => {
    const cards = new Map(
      demoConnectorCards(['kindle-direct-publishing', 'youtube', 'meta-business-suite'])
        .map((card) => [card.id, card]),
    );
    assert.equal(cards.get('kindle-direct-publishing')?.status, 'manual-import');
    assert.equal(cards.get('youtube')?.status, 'setup-required');
    assert.equal(cards.get('meta-business-suite')?.status, 'provider-approval-required');
  });

  it('keeps a planned provider unconfigurable and unlinked', () => {
    const cards = cardsById();
    assert.equal(cards.get('github')?.canConfigure, false);
    assert.equal(cards.get('github')?.connectHref, null);
  });
});
