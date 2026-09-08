import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectorCardsFromQueries } from './integration-query';
import type { ConnectorInstallationRow, ConnectorRegistryRow } from './integration-cards';

const ENV = ['CONNECTOR_OAUTH_STATE_SECRET', 'CONNECTOR_PUBLIC_ORIGIN',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

const REGISTRY: readonly ConnectorRegistryRow[] = [
  { id: 'slack-id', provider_key: 'slack', availability: 'available', is_active: true },
];
const CAPABILITIES = [{ id: 'cap', provider_id: 'slack-id', oauth_scopes: [] as readonly string[] }];
const CERTIFICATIONS = [{
  capability_id: 'cap', environment: 'sandbox', status: 'passed',
  certified_at: '2026-01-01T00:00:00.000Z', valid_until: null,
}];
const ok = <T,>(data: readonly T[]) => ({ data, error: null });
const failed = <T,>() => ({ data: null as readonly T[] | null, error: { message: 'permission denied' } });

function configure(): void {
  process.env.CONNECTOR_OAUTH_STATE_SECRET = 's'.repeat(48);
  process.env.CONNECTOR_PUBLIC_ORIGIN = 'https://hq.example.com';
  process.env.SLACK_CLIENT_ID = 'slack-client';
  process.env.SLACK_CLIENT_SECRET = 'slack-secret';
}

afterEach(() => {
  for (const name of ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('connectorCardsFromQueries', { concurrency: false }, () => {
  it('links a certified provider when every query succeeded', () => {
    configure();
    const cards = connectorCardsFromQueries(
      ok(REGISTRY), ok<ConnectorInstallationRow>([]), ok(CAPABILITIES), ok(CERTIFICATIONS),
    );
    const slack = cards.find((card) => card.id === 'slack');
    assert.equal(slack?.canConfigure, true);
    assert.equal(slack?.connectHref, '/api/connectors/slack/authorize');
  });

  it('fails closed to the inert catalog when the registry query errors', () => {
    configure();
    const cards = connectorCardsFromQueries(
      failed<ConnectorRegistryRow>(), ok<ConnectorInstallationRow>([]),
      ok(CAPABILITIES), ok(CERTIFICATIONS),
    );
    assert.ok(cards.length >= 20, 'the catalog stays visible');
    for (const card of cards) {
      assert.equal(card.canConfigure, false, `${card.id} must not be configurable`);
      assert.equal(card.connectHref, null, `${card.id} must carry no action`);
    }
  });

  it('fails closed the same way when the tenant installation query errors', () => {
    configure();
    const cards = connectorCardsFromQueries(
      ok(REGISTRY), failed<ConnectorInstallationRow>(), ok(CAPABILITIES), ok(CERTIFICATIONS),
    );
    assert.ok(cards.every((card) => !card.canConfigure), 'a tenant read failure fails closed');
  });

  it('narrows the actions, rather than the page, when only certification is lost', () => {
    // Certification gates authorization, not visibility, so losing it must leave
    // the connector visible and configurable but unlinked.
    configure();
    for (const [capabilities, certifications] of [
      [failed<typeof CAPABILITIES[number]>(), ok(CERTIFICATIONS)],
      [ok(CAPABILITIES), failed<typeof CERTIFICATIONS[number]>()],
    ] as const) {
      const slack = connectorCardsFromQueries(
        ok(REGISTRY), ok<ConnectorInstallationRow>([]), capabilities, certifications,
      ).find((card) => card.id === 'slack');
      assert.equal(slack?.canConfigure, true, 'the registry still permits setup');
      assert.equal(slack?.connectHref, null, 'but nothing is certified, so no link');
    }
  });

  it('treats a null data payload without an error as an empty result', () => {
    configure();
    const cards = connectorCardsFromQueries(
      { data: null, error: null }, { data: null, error: null },
      { data: null, error: null }, { data: null, error: null },
    );
    assert.ok(cards.length >= 20);
    assert.ok(cards.every((card) => !card.canConfigure), 'no registry rows means nothing to set up');
  });
});
