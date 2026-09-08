import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listConnectorCatalog } from '@platform/integrations';

import { connectorCardsOf, type ConnectorCard } from './integration-cards';
import { sharedEntry, sharedSetup, sharedStatus } from './mcp-store-projection';

function cardFor(id: string, patch: Partial<ConnectorCard> = {}): ConnectorCard {
  const registry = listConnectorCatalog()
    .filter((entry) => entry.availability !== 'coming-soon')
    .map((entry) => ({
      id: entry.descriptor.id, provider_key: entry.descriptor.id,
      availability: entry.availability.replaceAll('-', '_'), is_active: true,
    }));
  const card = connectorCardsOf(registry, []).find((candidate) => candidate.id === id);
  assert.ok(card, `${id} should be in the catalog`);
  return { ...card, ...patch };
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
