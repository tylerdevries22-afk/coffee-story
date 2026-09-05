import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  certifiedOAuthProviders,
  type ConnectorCertificationRow,
  withConnectorAuthorization,
} from './connector-auth-readiness';
import { defaultConnectorCards } from './integration-cards';

const NAMES = [
  'CONNECTOR_OAUTH_STATE_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
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
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
    const cards = withConnectorAuthorization(defaultConnectorCards(), new Set(['google-suite']));

    assert.equal(cards.find((card) => card.id === 'google-suite')?.connectHref,
      '/api/connectors/google-suite/authorize');
    assert.equal(cards.find((card) => card.id === 'stripe')?.connectHref, null);
    assert.equal(cards.find((card) => card.id === 'vercel')?.connectHref, null);
  });

  it('requires every enabled adapter capability to have current certification', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
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
    let square = withConnectorAuthorization(defaultConnectorCards())
      .find((card) => card.id === 'square');
    assert.equal(square?.connectHref, null);

    process.env.SQUARE_TOKEN_KEY = 'vault-key';
    square = withConnectorAuthorization(defaultConnectorCards())
      .find((card) => card.id === 'square');
    assert.equal(square?.connectHref, '/locations');
  });
});
