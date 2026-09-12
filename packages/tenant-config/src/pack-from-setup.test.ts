import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTenantManifest } from './parser';
import { tenantPackFromSetup } from './pack-from-setup';

const independent = {
  slug: 'harbor-roast',
  name: 'Harbor Roast',
  ownerEmail: 'owner@harbor.example',
  organizationKind: 'independent' as const,
  networkSlug: null,
  location: {
    name: 'Waterfront',
    address: { street: '12 Pier', city: 'Tacoma', region: 'WA', postal: '98402' },
    timezone: 'America/Los_Angeles',
    hours: {
      mon: [{ open: '07:00', close: '15:00' }],
      tue: [{ open: '07:00', close: '15:00' }],
      wed: [{ open: '07:00', close: '15:00' }],
      thu: [{ open: '07:00', close: '15:00' }],
      fri: [{ open: '07:00', close: '15:00' }],
      sat: [],
      sun: [],
    },
  },
  modules: [{ key: 'commerce-catalog', version: '1.0.0' }],
};

describe('tenantPackFromSetup', () => {
  it('emits a brand.json the tenant parser accepts', () => {
    const pack = tenantPackFromSetup(independent);
    const parsed = parseTenantManifest(pack.files['brand.json']);
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.equal(parsed.manifest.identity.slug, 'harbor-roast');
    assert.equal(parsed.manifest.identity.name, 'Harbor Roast');
    assert.equal(parsed.manifest.organization.kind, 'independent');
    assert.equal(parsed.manifest.locations[0]?.name, 'Waterfront');
    assert.equal(pack.files['brand.json'].copy && (pack.files['brand.json'].copy as { appName: string }).appName, 'Harbor Roast');
    assert.match(pack.files['menu.csv'], /house-latte/);
    assert.equal(pack.slug, 'harbor-roast');
  });

  it('never stamps Coffee Story into a new shop pack', () => {
    const pack = tenantPackFromSetup(independent);
    const blob = JSON.stringify(pack);
    assert.equal(blob.includes('Coffee Story'), false);
    assert.equal(blob.includes('coffee-story'), false);
  });

  it('requires network metadata for a franchisee', () => {
    const pack = tenantPackFromSetup({
      ...independent,
      slug: 'harbor-unit-4',
      name: 'Harbor Unit 4',
      organizationKind: 'franchisee',
      networkSlug: 'harbor-network',
    });
    const parsed = parseTenantManifest(pack.files['brand.json']);
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.equal(parsed.manifest.network?.slug, 'harbor-network');
    assert.equal(parsed.manifest.inheritance.mode, 'network');
  });
});
