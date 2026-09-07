import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getConnectorCatalogEntry,
  listConnectorCatalog,
  listConnectorsBySetupKind,
  type ConnectorSetupKind,
} from './index';

const KINDS: readonly ConnectorSetupKind[] = ['one-click-oauth', 'api-key', 'operator-portal'];

describe('connector setup guidance', () => {
  it('gives every connector a reachable, non-empty setup path', () => {
    for (const { descriptor, setup } of listConnectorCatalog()) {
      assert.ok(KINDS.includes(setup.kind), `${descriptor.id} needs a known setup kind`);
      assert.match(setup.consoleUrl, /^https:\/\//u, `${descriptor.id} console must be https`);
      assert.match(setup.documentationUrl, /^https:\/\//u, `${descriptor.id} docs must be https`);
      assert.ok(setup.steps.length > 0, `${descriptor.id} needs at least one step`);
      assert.ok(setup.estimatedMinutes >= 0 && setup.estimatedMinutes <= 15);
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

  it('wires one-click OAuth connectors to their own callback path', () => {
    const oneClick = listConnectorsBySetupKind('one-click-oauth');
    assert.ok(oneClick.length > 0);
    for (const { descriptor, setup } of oneClick) {
      assert.equal(descriptor.authentication, 'oauth2');
      assert.equal(setup.redirectPath, `/api/connectors/${descriptor.id}/callback`);
      assert.ok(setup.credentialEnvKeys.length > 0, `${descriptor.id} needs operator env keys`);
      assert.equal(setup.steps[0]?.text, 'Press Connect and approve the requested scopes.');
      assert.ok(setup.estimatedMinutes <= 2, `${descriptor.id} one-click setup must stay under 2 minutes`);
    }
  });

  it('points every API-key connector at the exact screen holding the key', () => {
    const apiKey = listConnectorsBySetupKind('api-key');
    assert.ok(apiKey.length > 0);
    for (const { descriptor, setup } of apiKey) {
      assert.equal(descriptor.authentication, 'api-key-reference');
      assert.equal(setup.redirectPath, undefined, `${descriptor.id} has no OAuth redirect`);
      assert.ok(setup.credentialEnvKeys.length > 0);
      assert.ok(
        setup.steps.some((step) => step.href === setup.consoleUrl),
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
      assert.deepEqual(connector?.setup.credentialEnvKeys, []);
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
