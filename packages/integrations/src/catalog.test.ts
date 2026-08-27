import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  APP_ZAP_CONNECTOR_SCHEMA,
  getConnectorCatalogEntry,
  listConnectorCatalog,
  listConnectorsByAvailability,
} from './index';

describe('operations connector catalog', () => {
  it('contains every launch provider and planned provider exactly once', () => {
    const catalog = listConnectorCatalog();
    const ids = catalog.map((entry) => entry.descriptor.id);

    assert.equal(new Set(ids).size, ids.length);
    for (const id of [
      'google-suite', 'square', 'stripe', 'quickbooks-online', 'plaid',
      'slack', 'twilio', 'resend', 'supabase', 'vercel', 'sentry',
      'shopify', 'sendgrid', 'cloudflare', 'github', 'expo',
      'apple-distribution', 'google-play', 'checkly', 'turnstile',
    ]) {
      assert.ok(ids.includes(id), `${id} should be registered`);
    }
  });

  it('emits App-Zap-compatible safety and credential metadata', () => {
    for (const catalogEntry of listConnectorCatalog()) {
      const { descriptor } = catalogEntry;
      assert.equal(descriptor.$schema, APP_ZAP_CONNECTOR_SCHEMA);
      assert.equal(descriptor.credentialOwnership, 'client');
      assert.equal(descriptor.resilience.circuitBreaker, true);
      assert.equal(descriptor.resilience.killSwitch, true);
      assert.ok(descriptor.resilience.maximumAttempts >= 2);
      assert.ok(descriptor.capabilities.length > 0);
      assert.match(catalogEntry.logo.brandColor, /^#[0-9A-F]{6}$/iu);
      assert.match(catalogEntry.logo.sourceUrl, /^https:\/\//u);
      assert.equal(catalogEntry.logo.license, 'CC0-1.0');
      assert.equal(catalogEntry.logo.attribution, 'Simple Icons contributors');
      assert.match(catalogEntry.logo.verifiedAt, /^\d{4}-\d{2}-\d{2}$/u);
    }
  });

  it('keeps sensitive finance capabilities read-only', () => {
    assert.deepEqual(
      getConnectorCatalogEntry('plaid')?.descriptor.capabilities.map(({ id }) => id),
      ['balances.read', 'transactions.sync'],
    );
    assert.ok(
      getConnectorCatalogEntry('stripe')?.descriptor.capabilities.every(
        ({ id }) => id.endsWith('.read'),
      ),
    );
  });

  it('offers Twilio and SendGrid as configurable communications providers', () => {
    for (const id of ['twilio', 'sendgrid']) {
      const connector = getConnectorCatalogEntry(id);

      assert.equal(connector?.availability, 'available');
      assert.equal(connector?.category, 'communications');
      assert.equal(connector?.descriptor.authentication, 'api-key-reference');
      assert.equal(connector?.descriptor.webhooks.signatureVerification, true);
      assert.ok(connector?.descriptor.capabilities.some(({ id: capabilityId }) =>
        capabilityId.endsWith('.send'),
      ));
    }
  });

  it('finds a provider by stable id and returns undefined for unknown ids', () => {
    assert.equal(getConnectorCatalogEntry('square')?.displayName, 'Square');
    assert.equal(getConnectorCatalogEntry('missing'), undefined);
  });

  it('filters coming-soon cards without representing them as certified', () => {
    const planned = listConnectorsByAvailability('coming-soon');
    assert.ok(planned.length > 0);
    assert.ok(planned.every(({ descriptor }) => descriptor.certification.state === 'uncertified'));
    assert.ok(
      planned.every(({ descriptor }) =>
        descriptor.capabilities.every(({ idempotency, reconciliation, sandbox }) =>
          !idempotency && !reconciliation && !sandbox,
        ),
      ),
    );
  });
});
