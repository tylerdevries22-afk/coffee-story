import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getConnectorCatalogEntry,
  listConnectorCatalog,
  type ConnectorSetupKind,
} from './index';

const KINDS: readonly ConnectorSetupKind[] = ['one-click-oauth', 'api-key', 'operator-portal'];

function ofKind(kind: ConnectorSetupKind) {
  return listConnectorCatalog().filter((entry) => entry.setup.kind === kind);
}

/**
 * Every callback path a route in `apps/hq` actually serves. The shared connector
 * route covers its own provider keys; Square predates it and serves its own.
 */
const ROUTED_CALLBACKS = new Set([
  ...['google-suite', 'stripe', 'quickbooks-online', 'slack',
    'meta-business-suite', 'youtube', 'tiktok'].map((id) => `/api/connectors/${id}/callback`),
  '/api/square/callback',
]);

describe('connector setup guidance', () => {
  it('carries no deployment secret names, because the catalog reaches the browser', () => {
    const serialized = JSON.stringify(listConnectorCatalog());
    for (const fragment of ['_SECRET', '_CLIENT_ID', '_API_KEY', 'APP_ID', 'CLIENT_KEY']) {
      assert.ok(
        !serialized.includes(fragment),
        `the catalog leaks ${fragment} to the client bundle`,
      );
    }
    assert.ok(!/credentialEnvKeys/u.test(serialized));
  });

  it('gives every connector a known setup kind and only https links', () => {
    for (const { descriptor, setup } of listConnectorCatalog()) {
      assert.ok(KINDS.includes(setup.kind), `${descriptor.id} needs a known setup kind`);
      if (setup.consoleUrl !== undefined) {
        assert.match(setup.consoleUrl, /^https:\/\//u, `${descriptor.id} console must be https`);
      }
      if (setup.documentationUrl !== undefined) {
        assert.match(setup.documentationUrl, /^https:\/\//u, `${descriptor.id} docs must be https`);
      }
      assert.ok(setup.estimatedMinutes >= 0 && setup.estimatedMinutes <= 15);
    }
  });

  it('gives every connectable provider a step, and roadmap entries none', () => {
    for (const { availability, descriptor, setup } of listConnectorCatalog()) {
      if (availability === 'coming-soon') {
        assert.deepEqual(setup.steps, [], `${descriptor.id} has nothing to configure yet`);
        assert.equal(setup.consoleUrl, undefined, `${descriptor.id} must link no console`);
        assert.equal(setup.documentationUrl, undefined, `${descriptor.id} must link no docs`);
        continue;
      }
      assert.ok(setup.steps.length > 0, `${descriptor.id} needs at least one step`);
      assert.match(setup.consoleUrl ?? '', /^https:\/\//u, `${descriptor.id} needs a console`);
      assert.match(setup.documentationUrl ?? '', /^https:\/\//u, `${descriptor.id} needs docs`);
    }
  });

  it('keeps every step one short imperative line with a safe link', () => {
    for (const { descriptor, setup } of listConnectorCatalog()) {
      for (const step of setup.steps) {
        assert.ok(step.text.trim().length > 0, `${descriptor.id} has a blank step`);
        assert.ok(step.text.length <= 140, `${descriptor.id} step is too long to skim`);
        if (step.href !== undefined) {
          assert.match(
            step.href, /^(?:https:\/\/\S+|\/[a-z0-9/-]*)$/u,
            `${descriptor.id} step link must be https or an in-app path`,
          );
        }
      }
    }
  });

  it('publishes a redirect path only where a route actually serves it', () => {
    const oneClick = ofKind('one-click-oauth');
    assert.ok(oneClick.length > 0);
    for (const { descriptor, setup } of oneClick) {
      assert.equal(descriptor.authentication, 'oauth2');
      assert.ok(setup.estimatedMinutes <= 2, `${descriptor.id} one-click setup must stay under 2 minutes`);
      if (setup.redirectPath === undefined) continue;
      assert.ok(
        ROUTED_CALLBACKS.has(setup.redirectPath),
        `${descriptor.id} publishes ${setup.redirectPath}, which no route serves`,
      );
    }
  });

  it('never tells a reader to press Connect where no adapter is wired', () => {
    // These three declare OAuth as the intended mechanism but are absent from the
    // host's OAUTH_CONNECTOR_KEYS, so no press can ever start a flow today.
    for (const id of ['supabase', 'vercel', 'sentry']) {
      const setup = getConnectorCatalogEntry(id)?.setup;
      assert.equal(setup?.redirectPath, undefined, `${id} has no callback route`);
      assert.match(setup?.steps[0]?.text ?? '', /certification is pending/u, `${id} must say so`);
    }
    for (const id of ['google-suite', 'stripe', 'slack', 'youtube', 'tiktok', 'meta-business-suite']) {
      assert.equal(
        getConnectorCatalogEntry(id)?.setup.steps[0]?.text,
        'Press Connect and approve the requested scopes.',
        `${id} is wired, so Connect is the first step`,
      );
    }
  });

  it('points every API-key connector at the exact screen holding the key', () => {
    const apiKey = ofKind('api-key');
    assert.ok(apiKey.length > 0);
    for (const { descriptor, setup } of apiKey) {
      assert.equal(descriptor.authentication, 'api-key-reference');
      assert.equal(setup.redirectPath, undefined, `${descriptor.id} has no OAuth redirect`);
      assert.ok(
        setup.consoleUrl !== undefined
          && setup.steps.some((step) => step.href === setup.consoleUrl),
        `${descriptor.id} must link its credential console from a step`,
      );
      assert.ok(setup.steps.length <= 4, `${descriptor.id} setup must stay skimmable`);
    }
  });

  it('never implies an API exists for manual-only providers', () => {
    for (const id of ['kindle-direct-publishing', 'acx-audiobooks']) {
      const connector = getConnectorCatalogEntry(id);
      assert.equal(connector?.availability, 'manual-only', `${id} is manual only`);
      assert.equal(connector?.descriptor.authentication, 'operator-portal');
      assert.equal(connector?.setup.kind, 'operator-portal');
      assert.equal(connector?.setup.redirectPath, undefined);
      assert.ok(
        connector?.descriptor.capabilities.every(({ sandbox }) => !sandbox),
        `${id} must not claim a sandbox contract`,
      );
    }
  });

  it('exposes the new publishing and audience providers as connectable', () => {
    for (const id of ['meta-business-suite', 'youtube', 'tiktok']) {
      assert.equal(getConnectorCatalogEntry(id)?.setup.kind, 'one-click-oauth', `${id} is one-click`);
    }
    for (const id of ['transistor', 'beehiiv']) {
      assert.equal(getConnectorCatalogEntry(id)?.setup.kind, 'api-key', `${id} is key based`);
      assert.equal(getConnectorCatalogEntry(id)?.availability, 'available');
    }
  });
});
