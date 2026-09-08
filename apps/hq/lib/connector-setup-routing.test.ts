import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { listConnectorCatalog } from '@platform/integrations';

import { connectorCardsOf, defaultConnectorCards, demoConnectorCards } from './integration-cards';
import { certifiedOAuthProviders, withConnectorAuthorization } from './connector-auth-readiness';

const ENV = [
  'CONNECTOR_OAUTH_STATE_SECRET', 'CONNECTOR_PUBLIC_ORIGIN',
  'SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_TOKEN_KEY',
  'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
  'META_APP_ID', 'META_APP_SECRET',
] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

const OAUTH_IDS = ['youtube', 'tiktok', 'meta-business-suite'] as const;

/** Satisfies every gate except the one a test is isolating. */
function configureEverything(): void {
  process.env.CONNECTOR_OAUTH_STATE_SECRET = 's'.repeat(48);
  process.env.CONNECTOR_PUBLIC_ORIGIN = 'https://hq.example.com';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = 'youtube-client';
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'youtube-secret';
  process.env.TIKTOK_CLIENT_KEY = 'tiktok-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tiktok-secret';
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-secret';
}

/** Mirrors an activated registry: every non-planned provider live for the tenant. */
function activeRegistry(overrides: Readonly<Record<string, Partial<{
  availability: string; is_active: boolean;
}>>> = {}) {
  return listConnectorCatalog()
    .filter((entry) => entry.availability !== 'coming-soon')
    .map((entry) => ({
      id: entry.descriptor.id,
      provider_key: entry.descriptor.id,
      availability: entry.availability.replaceAll('-', '_'),
      is_active: true,
      ...overrides[entry.descriptor.id],
    }));
}

function cardsById(
  certified: readonly string[] = [],
  overrides: Parameters<typeof activeRegistry>[0] = {},
) {
  const cards = withConnectorAuthorization(
    connectorCardsOf(activeRegistry(overrides), []), new Set(certified),
  );
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
  it('gives every connectable card the setup block its provider declares', () => {
    for (const card of defaultConnectorCards()) {
      if (card.availability === 'coming-soon') continue;
      assert.ok(card.setup.steps.length > 0, `${card.id} lost its setup steps`);
      assert.match(card.setup.consoleUrl ?? '', /^https:\/\//u);
    }
  });

  it('links an OAuth provider once every gate is satisfied', () => {
    configureEverything();
    const cards = cardsById([...OAUTH_IDS]);
    for (const id of OAUTH_IDS) {
      assert.equal(
        cards.get(id)?.connectHref, `/api/connectors/${id}/authorize`,
        `${id} should be connectable when certified and configured`,
      );
      assert.equal(cards.get(id)?.connectLabel, 'Connect');
    }
  });

  it('withholds the link on certification alone, with every other gate satisfied', () => {
    configureEverything();
    const cards = cardsById([]);
    for (const id of OAUTH_IDS) {
      assert.equal(cards.get(id)?.connectHref, null, `${id} must await certification`);
    }
  });

  it('withholds the link on the state secret alone, with every other gate satisfied', () => {
    configureEverything();
    delete process.env.CONNECTOR_OAUTH_STATE_SECRET;
    for (const id of OAUTH_IDS) {
      assert.equal(cardsById([...OAUTH_IDS]).get(id)?.connectHref, null, `${id} needs a state secret`);
    }
    // A secret shorter than 32 bytes is as good as absent.
    process.env.CONNECTOR_OAUTH_STATE_SECRET = 'short';
    for (const id of OAUTH_IDS) {
      assert.equal(cardsById([...OAUTH_IDS]).get(id)?.connectHref, null, `${id} needs 32+ bytes`);
    }
  });

  it('withholds the link on provider credentials alone, with every other gate satisfied', () => {
    configureEverything();
    delete process.env.TIKTOK_CLIENT_SECRET;
    const cards = cardsById([...OAUTH_IDS]);
    assert.equal(cards.get('tiktok')?.connectHref, null, 'tiktok is missing its secret');
    assert.equal(
      cards.get('youtube')?.connectHref, '/api/connectors/youtube/authorize',
      'the other providers are unaffected',
    );
  });

  it('obeys the registry kill switch even when the provider is certified', () => {
    configureEverything();
    const cards = cardsById([...OAUTH_IDS], { youtube: { is_active: false } });
    assert.equal(cards.get('youtube')?.canConfigure, false);
    assert.equal(cards.get('youtube')?.connectHref, null, 'a deactivated provider must not link');
    assert.equal(cards.get('youtube')?.statusLabel, 'Disabled');
  });

  it('drops a deactivated provider from the certified set as well as the card', () => {
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
    assert.equal(certified.has('youtube'), false, 'an inactive row is not certified');
    assert.equal(certified.has('tiktok'), false, 'a disabled availability is not certified');
    assert.equal(certified.has('slack'), true, 'an active, available row is certified');
  });

  it('leaves an API-key provider without a redirect, because no route accepts a key', () => {
    configureEverything();
    const cards = cardsById([...OAUTH_IDS]);
    for (const id of ['transistor', 'beehiiv']) {
      assert.equal(cards.get(id)?.canConfigure, true, `${id} is configurable`);
      assert.equal(cards.get(id)?.connectHref, null, `${id} has no endpoint to post a key to`);
      assert.equal(cards.get(id)?.setup.kind, 'api-key');
    }
  });

  it('rests a manual-only provider at setup required until something is imported', () => {
    const cards = cardsById();
    for (const id of ['kindle-direct-publishing', 'acx-audiobooks']) {
      assert.equal(cards.get(id)?.isManualOnly, true, `${id} is manual only`);
      assert.equal(cards.get(id)?.canConfigure, true, `${id} is configurable`);
      assert.equal(cards.get(id)?.connectHref, null, `${id} has no import endpoint yet`);
      assert.equal(
        cards.get(id)?.statusLabel, 'Setup required',
        `${id} has imported nothing, so it is not "Manual import"`,
      );
    }
  });

  it('reports manual import only once an installation exists', () => {
    const cards = new Map(
      demoConnectorCards(['kindle-direct-publishing', 'youtube', 'meta-business-suite'])
        .map((card) => [card.id, card]),
    );
    assert.equal(cards.get('kindle-direct-publishing')?.status, 'manual-import');
    assert.equal(cards.get('youtube')?.status, 'setup-required');
    assert.equal(cards.get('meta-business-suite')?.status, 'provider-approval-required');
    assert.equal(cards.get('acx-audiobooks')?.status, 'setup-required', 'unselected stays untouched');
  });

  it('fails closed when the registry row disagrees with the code catalog', () => {
    // An operator marking an OAuth provider manual-only is an error, not a
    // request to treat Slack as a spreadsheet import.
    const cards = cardsById([], { slack: { availability: 'manual_only' } });
    assert.equal(cards.get('slack')?.canConfigure, false);
    assert.equal(cards.get('slack')?.statusLabel, 'Disabled');
    assert.equal(cards.get('slack')?.isManualOnly, false);
  });

  it('fails closed on an availability the code does not recognize', () => {
    const cards = cardsById([], { slack: { availability: 'retired' } });
    assert.equal(cards.get('slack')?.canConfigure, false);
    assert.equal(cards.get('slack')?.statusLabel, 'Disabled');
  });

  it('withholds every action when the registry is unavailable', () => {
    configureEverything();
    const cards = withConnectorAuthorization(defaultConnectorCards(), new Set(OAUTH_IDS));
    assert.ok(cards.length > 0);
    for (const card of cards) {
      assert.equal(card.connectHref, null, `${card.id} must fail closed`);
      assert.equal(card.canConfigure, false, `${card.id} must not be configurable`);
    }
  });

  it('links Square by location only once its own credentials are present', () => {
    assert.equal(cardsById().get('square')?.connectHref, null);
    process.env.SQUARE_APP_ID = 'sq-app';
    process.env.SQUARE_APP_SECRET = 'sq-secret';
    process.env.SQUARE_TOKEN_KEY = 'sq-token';
    assert.equal(cardsById().get('square')?.connectHref, '/locations');
    assert.equal(cardsById().get('square')?.connectLabel, 'Choose location');
  });

  it('keeps a planned provider unconfigurable, unlinked and undocumented', () => {
    const cards = cardsById();
    assert.equal(cards.get('github')?.canConfigure, false);
    assert.equal(cards.get('github')?.connectHref, null);
    assert.deepEqual(cards.get('github')?.setup.steps, []);
    assert.equal(cards.get('github')?.setup.consoleUrl, undefined);
  });
});
