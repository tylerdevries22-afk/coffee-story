import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  withConnectorAuthorization,
} from './connector-auth-readiness';
import {
  defaultConnectorCards,
  demoConnectorCards,
} from './integration-cards';
import {
  cardsById,
  certifiedOAuthProviders,
  configureEverything,
  OAUTH_IDS,
  restoreConnectorTestEnvironment,
} from './connector-setup-routing-test-helpers';

afterEach(restoreConnectorTestEnvironment);

describe('connector setup card states', { concurrency: false }, () => {
  it('refuses certification without an enabled requested capability', () => {
    configureEverything();
    const registry = [{ id: 'p1', provider_key: 'slack', availability: 'available', is_active: true }];
    assert.equal(certifiedOAuthProviders(registry, [], []).has('slack'), false);
    const unrequested = [{
      id: 'cap', provider_id: 'p1', oauth_scopes: ['chat:write.customize'],
    }];
    const passed = [{
      capability_id: 'cap', environment: 'sandbox', status: 'passed',
      certified_at: '2026-01-01T00:00:00.000Z', valid_until: null,
    }];
    assert.equal(certifiedOAuthProviders(registry, unrequested, passed).has('slack'), false);
  });

  it('requires every enabled capability to be certified', () => {
    configureEverything();
    const registry = [{ id: 'p1', provider_key: 'slack', availability: 'available', is_active: true }];
    const capabilities = [
      { id: 'read', provider_id: 'p1', oauth_scopes: ['channels:read'] },
      { id: 'write', provider_id: 'p1', oauth_scopes: ['chat:write'] },
    ];
    const row = (id: string) => ({
      capability_id: id, environment: 'sandbox', status: 'passed',
      certified_at: '2026-01-01T00:00:00.000Z', valid_until: null,
    });
    assert.equal(certifiedOAuthProviders(registry, capabilities, [row('read')]).has('slack'), false);
    assert.equal(certifiedOAuthProviders(
      registry, capabilities, [row('read'), row('write')],
    ).has('slack'), true);
  });

  it('leaves API-key providers without an unimplemented action', () => {
    configureEverything();
    const cards = cardsById([...OAUTH_IDS]);
    for (const id of ['transistor', 'beehiiv']) {
      assert.equal(cards.get(id)?.canConfigure, true);
      assert.equal(cards.get(id)?.connectHref, null);
      assert.equal(cards.get(id)?.setup.kind, 'api-key');
    }
  });

  it('shows manual import only after an installation exists', () => {
    const empty = cardsById();
    for (const id of ['kindle-direct-publishing', 'acx-audiobooks']) {
      assert.equal(empty.get(id)?.isManualOnly, true);
      assert.equal(empty.get(id)?.canConfigure, true);
      assert.equal(empty.get(id)?.connectHref, null);
      assert.equal(empty.get(id)?.statusLabel, 'Setup required');
    }
    const installed = new Map(
      demoConnectorCards(['kindle-direct-publishing', 'youtube', 'meta-business-suite'])
        .map((card) => [card.id, card]),
    );
    assert.equal(installed.get('kindle-direct-publishing')?.status, 'manual-import');
    assert.equal(installed.get('youtube')?.status, 'setup-required');
    assert.equal(installed.get('meta-business-suite')?.status, 'provider-approval-required');
    assert.equal(installed.get('acx-audiobooks')?.status, 'setup-required');
  });

  it('fails closed when the registry and code catalog disagree', () => {
    const card = cardsById([], { slack: { availability: 'manual_only' } }).get('slack');
    assert.equal(card?.canConfigure, false);
    assert.equal(card?.statusLabel, 'Disabled');
    assert.equal(card?.isManualOnly, false);
  });

  it('withholds every action when the registry is unavailable', () => {
    configureEverything();
    const cards = withConnectorAuthorization(defaultConnectorCards(), new Set(OAUTH_IDS));
    assert.ok(cards.length > 0);
    for (const card of cards) {
      assert.equal(card.connectHref, null);
      assert.equal(card.canConfigure, false);
    }
  });

  it('links Square only when its complete credential tuple is present', () => {
    assert.equal(cardsById().get('square')?.connectHref, null);
    process.env.SQUARE_APP_ID = 'sq-app';
    process.env.SQUARE_APP_SECRET = 'sq-secret';
    process.env.SQUARE_TOKEN_KEY = 'sq-token';
    assert.equal(cardsById().get('square')?.connectHref, '/locations');
    assert.equal(cardsById().get('square')?.connectLabel, 'Choose location');
  });

  it('keeps planned providers unavailable and undocumented', () => {
    const card = cardsById().get('github');
    assert.equal(card?.canConfigure, false);
    assert.equal(card?.connectHref, null);
    assert.deepEqual(card?.setup.steps, []);
    assert.equal(card?.setup.consoleUrl, undefined);
  });
});
