import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listConnectorCatalog } from '@platform/integrations';

import { connectorCardsOf, type ConnectorCard } from './integration-cards';
import { STATUS_LABELS } from './integration-card-status';
import { hasScopeGap, readinessLabel, sharedEntry, sharedSetup, sharedStatus } from './mcp-store-projection';

function cardFor(id: string, patch: Partial<ConnectorCard> = {}): ConnectorCard {
  const registry = listConnectorCatalog()
    .filter((entry) => entry.availability !== 'coming-soon')
    .map((entry) => ({
      id: entry.descriptor.id, provider_key: entry.descriptor.id,
      availability: entry.availability.replaceAll('-', '_'), is_active: true,
    }));
  const card = connectorCardsOf(registry, []).find((candidate) => candidate.id === id);
  assert.ok(card, `${id} should be in the catalog`);
  // statusLabel is derived from status in production, so keep them consistent when
  // a test patches one of them.
  const merged = { ...card, ...patch };
  return patch.status && !patch.statusLabel
    ? { ...merged, statusLabel: STATUS_LABELS[patch.status] }
    : merged;
}

describe('mcp store projection', () => {
  it('reads a healthy connection as connected and a degraded one as reconnect', () => {
    assert.equal(sharedStatus(cardFor('slack', { status: 'connected-healthy' }), 'manage'), 'connected');
    assert.equal(sharedStatus(cardFor('slack', { status: 'connected-degraded' }), 'manage'), 'reconnect');
    assert.equal(
      sharedStatus(cardFor('slack', { status: 'reauthorization-required' }), 'manage'), 'reconnect',
    );
  });

  it('reserves unavailable for a connector the tenant cannot set up at all', () => {
    // A deactivated manual-only import must not advertise an action beside a
    // "Disabled" label, whatever kind of provider it is.
    const disabled = cardFor('kindle-direct-publishing', { status: 'disabled', canConfigure: false });
    assert.equal(sharedStatus(disabled, 'manage'), 'unavailable');
    assert.equal(sharedStatus(cardFor('youtube', { canConfigure: false }), 'manage'), 'unavailable');
    assert.equal(sharedStatus(cardFor('acx-audiobooks', { canConfigure: false }), 'manage'), 'unavailable');
  });

  it('never contradicts a live how-to by badging the row unavailable', () => {
    // Every API-key provider is configurable and deliberately carries no button,
    // because no route accepts a pasted key yet. Badging that "Unavailable" beside
    // "Setup required" and working console links contradicts itself.
    for (const id of ['transistor', 'beehiiv', 'twilio', 'resend', 'sendgrid', 'plaid']) {
      const card = cardFor(id);
      assert.equal(card.canConfigure, true, `${id} is configurable`);
      assert.equal(card.connectHref, null, `${id} has no button`);
      assert.equal(sharedStatus(card, 'manage'), 'not_connected', `${id} is simply not connected`);
    }
  });

  it('reads manual only once an import relationship exists', () => {
    assert.equal(
      sharedStatus(cardFor('acx-audiobooks'), 'manage'), 'not_connected',
      'nothing imported yet, so it is not "Manual import"',
    );
    assert.equal(
      sharedStatus(cardFor('acx-audiobooks', { status: 'manual-import' }), 'manage'), 'manual',
    );
    // The kind alone is not enough: an OAuth provider never reads as manual.
    assert.equal(
      sharedStatus(cardFor('youtube', { status: 'manual-import' }), 'manage'), 'not_connected',
    );
  });

  it('offers a reconnect when a granular consent screen granted less than advertised', () => {
    // A green card that silently delivers nothing is worse than an honest gap, and
    // re-consent is only reachable by connecting again.
    const partial = cardFor('meta-business-suite', {
      status: 'connected-healthy', isConnected: true,
      capabilityCount: 6, enabledCapabilityCount: 1,
    });
    assert.equal(hasScopeGap(partial), true);
    assert.equal(sharedStatus(partial, 'manage'), 'reconnect');
    assert.equal(readinessLabel(partial, 'manage'), 'Connected with 1 of 6 capabilities');
  });

  it('reads a full grant as plainly connected', () => {
    const full = cardFor('meta-business-suite', {
      status: 'connected-healthy', isConnected: true,
      capabilityCount: 6, enabledCapabilityCount: 6,
    });
    assert.equal(hasScopeGap(full), false);
    assert.equal(sharedStatus(full, 'manage'), 'connected');
    assert.equal(readinessLabel(full, 'manage'), 'Connected and healthy');
  });

  it('never hides a live connection behind the configurability gate', () => {
    // An operator deactivating a provider must not make a tenant's existing
    // connection read as though it never existed.
    const connected = cardFor('slack', {
      status: 'connected-healthy', isConnected: true, canConfigure: false,
      capabilityCount: 3, enabledCapabilityCount: 3,
    });
    assert.equal(sharedStatus(connected, 'manage'), 'connected');
    const degraded = cardFor('slack', {
      status: 'connected-degraded', isConnected: true, canConfigure: false,
    });
    assert.equal(sharedStatus(degraded, 'manage'), 'reconnect');
  });

  it('keeps the readiness line agreeing with the badge beside it', () => {
    // A badge reading "Unavailable" must not sit next to the installation's own
    // status one column to the left.
    for (const status of ['setup-required', 'connecting', 'available', 'manual-import'] as const) {
      const blocked = cardFor('beehiiv', { status, canConfigure: false });
      assert.equal(sharedStatus(blocked, 'manage'), 'unavailable');
      assert.equal(
        readinessLabel(blocked, 'manage'), 'Unavailable',
        `${status} must not be reported beside an Unavailable badge`,
      );
    }
    // "Disabled" is itself an unavailable reading, so it survives as the more
    // specific of the two.
    const disabled = cardFor('beehiiv', { status: 'disabled', canConfigure: false });
    assert.equal(readinessLabel(disabled, 'manage'), 'Disabled');
  });

  it('reads a linked OAuth provider as not connected until it connects', () => {
    assert.equal(
      sharedStatus(cardFor('youtube', { connectHref: '/api/connectors/youtube/authorize' }), 'manage'),
      'not_connected',
    );
    assert.equal(sharedStatus(cardFor('youtube', { status: 'connected-healthy' }), 'manage'), 'connected');
  });

  it('judges selection mode on configurability, not on a link', () => {
    assert.equal(sharedStatus(cardFor('youtube', { connectHref: null }), 'select'), 'not_connected');
    assert.equal(sharedStatus(cardFor('youtube', { canConfigure: false }), 'select'), 'unavailable');
  });

  it('never teaches setup for a connector the tenant cannot set up', () => {
    // The fail-closed projection: a transient registry error must not render
    // "Unavailable" beside a live "Press Connect and approve the scopes" walkthrough.
    for (const card of connectorCardsOf([], [])) {
      assert.equal(card.canConfigure, false, `${card.id} is not configurable`);
      assert.equal(sharedStatus(card, 'manage'), 'unavailable');
      assert.equal(sharedSetup(card), undefined, `${card.id} must show no guidance`);
      assert.equal(sharedEntry(card, 'manage').setup, undefined);
    }
  });

  it('omits setup guidance where a reader has nothing to act on', () => {
    const planned = connectorCardsOf([], []).find((card) => card.id === 'github');
    assert.ok(planned);
    assert.equal(sharedSetup(planned), undefined, 'a roadmap entry has no guidance');
    const emptied = cardFor('youtube', {
      setup: { ...cardFor('youtube').setup, steps: [] },
    });
    assert.equal(sharedSetup(emptied), undefined, 'no steps means no disclosure');
  });

  it('carries the console and documentation links through, nulling absent ones', () => {
    const setup = sharedSetup(cardFor('transistor'));
    assert.equal(setup?.kind, 'api-key');
    assert.equal(setup?.consoleHref, 'https://dashboard.transistor.fm/account');
    assert.equal(setup?.consoleLabel, 'Open the key screen');
    assert.equal(setup?.documentationHref, 'https://developers.transistor.fm/');
  });

  it('labels each setup kind with the console wording that matches it', () => {
    assert.equal(sharedSetup(cardFor('youtube'))?.consoleLabel, 'Open provider console');
    assert.equal(sharedSetup(cardFor('beehiiv'))?.consoleLabel, 'Open the key screen');
    assert.equal(
      sharedSetup(cardFor('kindle-direct-publishing'))?.consoleLabel, 'Open the provider portal',
    );
  });

  it('never sends setup guidance into onboarding selection', () => {
    assert.equal(sharedEntry(cardFor('transistor'), 'select').setup, undefined);
    assert.ok(sharedEntry(cardFor('transistor'), 'manage').setup);
  });

  it('projects an entry the store can render without reaching for tenant internals', () => {
    const entry = sharedEntry(cardFor('slack'), 'manage');
    assert.equal(entry.id, 'slack');
    assert.equal(entry.name, 'Slack');
    assert.equal(entry.type, 'Communications');
    assert.equal(entry.popular, true);
    assert.equal(entry.detailHref, '/integrations/slack');
    assert.equal(sharedEntry(cardFor('transistor'), 'manage').popular, false);
  });
});
