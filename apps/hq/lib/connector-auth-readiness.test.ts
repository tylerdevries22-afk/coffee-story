import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  certifiedOAuthProviders,
  type ConnectorCertificationRow,
  withConnectorAuthorization,
} from './connector-auth-readiness';
import { connectorCardsOf, defaultConnectorCards } from './integration-cards';
import { listConnectorCatalog } from '@platform/integrations';

/**
 * Cards built from an activated registry, the way `loadConnectorCards` does.
 *
 * `defaultConnectorCards()` is the fail-closed projection used when the registry
 * cannot be read, so nothing there is configurable and nothing may be linked.
 */
function activeCards() {
  return connectorCardsOf(
    listConnectorCatalog()
      .filter((entry) => entry.availability !== 'coming-soon')
      .map((entry) => ({
        id: entry.descriptor.id, provider_key: entry.descriptor.id,
        availability: entry.availability.replaceAll('-', '_'), is_active: true,
      })),
    [],
  );
}

const NAMES = [
  'CONNECTOR_OAUTH_STATE_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_PROJECT_NUMBER',
  'SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_TOKEN_KEY',
] as const;
const ORIGINAL = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of NAMES) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('withConnectorAuthorization', { concurrency: false }, () => {
  it('advertises only configured routes backed by implemented adapters', () => {
    process.env.CONNECTOR_OAUTH_STATE_SECRET = 's'.repeat(32);
    process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
    const cards = withConnectorAuthorization(activeCards(), new Set(['google-suite']));

    assert.equal(cards.find((card) => card.id === 'google-suite')?.connectHref,
      '/api/connectors/google-suite/authorize');
    assert.equal(cards.find((card) => card.id === 'stripe')?.connectHref, null);
    assert.equal(cards.find((card) => card.id === 'vercel')?.connectHref, null);
  });

  it('links nothing at all when the registry could not be read', () => {
    process.env.CONNECTOR_OAUTH_STATE_SECRET = 's'.repeat(32);
    process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
    // Certified, configured, and still no link: without a registry row there is
    // no tenant permission to act on, so the fail-closed projection stays inert.
    for (const card of withConnectorAuthorization(defaultConnectorCards(), new Set(['google-suite']))) {
      assert.equal(card.connectHref, null, `${card.id} must fail closed`);
    }
  });

  it('requires every enabled adapter capability to have current certification', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
    const registry = [{ id: 'google-id', provider_key: 'google-suite' }];
    const capabilities = [
      { id: 'drive-id', provider_id: 'google-id', oauth_scopes: ['https://www.googleapis.com/auth/drive.file'] },
      { id: 'calendar-id', provider_id: 'google-id', oauth_scopes: ['https://www.googleapis.com/auth/calendar.events'] },
    ];
    const onePassed: readonly ConnectorCertificationRow[] = [{
      capability_id: 'drive-id', environment: 'sandbox', status: 'passed',
      certified_at: '2026-09-01T00:00:00Z', valid_until: '2026-10-01T00:00:00Z' }];
    assert.equal(certifiedOAuthProviders(registry, capabilities, onePassed, Date.parse('2026-09-05')).size, 0);
    const calendarPassed: ConnectorCertificationRow = {
      capability_id: 'calendar-id', environment: 'sandbox', status: 'passed',
      certified_at: '2026-09-01T00:00:00Z', valid_until: '2026-10-01T00:00:00Z',
    };
    const allPassed = [...onePassed, calendarPassed];
    assert.deepEqual([...certifiedOAuthProviders(
      registry, capabilities, allPassed, Date.parse('2026-09-05'),
    )], ['google-suite']);
  });

  it('keeps Square unavailable until every encryption and OAuth key exists', () => {
    process.env.SQUARE_APP_ID = 'id';
    process.env.SQUARE_APP_SECRET = 'secret';
    let square = withConnectorAuthorization(activeCards())
      .find((card) => card.id === 'square');
    assert.equal(square?.connectHref, null);

    process.env.SQUARE_TOKEN_KEY = 'vault-key';
    square = withConnectorAuthorization(activeCards())
      .find((card) => card.id === 'square');
    assert.equal(square?.connectHref, '/locations');
  });
});
