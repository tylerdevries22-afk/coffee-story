import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { connectorCardsFromQueries } from './integration-query';
import { hasScopeGap, sharedStatus } from './mcp-store-projection';
import type { ConnectorInstallationRow, ConnectorRegistryRow } from './integration-cards';

const ENV = ['CONNECTOR_OAUTH_STATE_SECRET', 'CONNECTOR_PUBLIC_ORIGIN',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'META_APP_ID', 'META_APP_SECRET'] as const;
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

  it('measures a grant against what this deployment asks for, not the catalog', () => {
    // meta-business-suite lists six capabilities; three of them need scopes that
    // are deliberately withheld until App Review. A user who granted everything
    // askable must read as connected, not as a partial grant with a Reconnect that
    // could never widen anything.
    process.env.META_APP_ID = 'meta-app';
    process.env.META_APP_SECRET = 'meta-secret';
    const registry = [
      { id: 'meta-id', provider_key: 'meta-business-suite', availability: 'provider_approval_required', is_active: true },
    ];
    const capabilities = [
      { id: 'pages-read', provider_id: 'meta-id', oauth_scopes: ['pages_show_list'] },
      { id: 'insights', provider_id: 'meta-id', oauth_scopes: ['read_insights'] },
      { id: 'ads', provider_id: 'meta-id', oauth_scopes: ['ads_read'] },
      // Withheld until App Review, so never authorizable today.
      { id: 'publish', provider_id: 'meta-id', oauth_scopes: ['pages_manage_posts'] },
      { id: 'instagram', provider_id: 'meta-id', oauth_scopes: ['instagram_basic'] },
      { id: 'leads', provider_id: 'meta-id', oauth_scopes: ['leads_retrieval'] },
    ];
    const installed = [{
      id: 'meta-inst', provider_id: 'meta-id', status: 'connected_healthy',
      external_account_label: 'Coffee Story', enabled_capabilities: ['pages-read', 'insights', 'ads'],
      connected_at: '2026-09-01T00:00:00.000Z', last_synced_at: null,
      updated_at: '2026-09-01T00:00:00.000Z',
    }];

    const meta = connectorCardsFromQueries(
      ok(registry), ok(installed), ok(capabilities), ok([]),
    ).find((card) => card.id === 'meta-business-suite');

    assert.equal(meta?.capabilityCount, 6, 'the catalog still lists six');
    assert.equal(meta?.authorizableCapabilityCount, 3, 'but only three are askable today');
    assert.equal(meta?.enabledCapabilityCount, 3);
    assert.equal(hasScopeGap(meta!), false, 'so a full grant is not a gap');
    assert.equal(sharedStatus(meta!, 'manage'), 'connected');
  });

  it('reports a real gap when an askable capability was declined', () => {
    process.env.META_APP_ID = 'meta-app';
    process.env.META_APP_SECRET = 'meta-secret';
    const registry = [
      { id: 'meta-id', provider_key: 'meta-business-suite', availability: 'provider_approval_required', is_active: true },
    ];
    const capabilities = [
      { id: 'pages-read', provider_id: 'meta-id', oauth_scopes: ['pages_show_list'] },
      { id: 'ads', provider_id: 'meta-id', oauth_scopes: ['ads_read'] },
    ];
    const installed = [{
      id: 'meta-inst', provider_id: 'meta-id', status: 'connected_healthy',
      external_account_label: 'Coffee Story', enabled_capabilities: ['pages-read'],
      connected_at: '2026-09-01T00:00:00.000Z', last_synced_at: null,
      updated_at: '2026-09-01T00:00:00.000Z',
    }];

    const meta = connectorCardsFromQueries(
      ok(registry), ok(installed), ok(capabilities), ok([]),
    ).find((card) => card.id === 'meta-business-suite');

    assert.equal(meta?.authorizableCapabilityCount, 2);
    assert.equal(hasScopeGap(meta!), true, 'ads_read was asked for and declined');
    assert.equal(sharedStatus(meta!, 'manage'), 'reconnect');
  });

  it('leaves the count at the catalog total when the capability rows are unavailable', () => {
    const cards = connectorCardsFromQueries(
      ok(REGISTRY), ok<ConnectorInstallationRow>([]),
      failed<typeof CAPABILITIES[number]>(), ok(CERTIFICATIONS),
    );
    const slack = cards.find((card) => card.id === 'slack');
    assert.equal(
      slack?.authorizableCapabilityCount, slack?.capabilityCount,
      'an unknown askable set must not manufacture a gap',
    );
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
