import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTenantManifest } from './parser';

const LOCATION = {
  name: 'Main', address: { city: 'Denver' }, timezone: 'America/Denver',
  hours: { mon: [{ open: '08:00', close: '17:00' }] },
};

function raw(locationFields: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1, organization: { kind: 'independent' }, network: null,
    inheritance: { mode: 'standalone', sourceTenantSlug: null, revision: 1, overrides: [] },
    surfaces: ['customer'], providers: [],
    identity: {
      slug: 'test', name: 'Test', bundleId: 'com.test.app', scheme: 'test',
      kioskBundleId: 'com.test.kiosk', kioskScheme: 'test-kiosk', easProjectId: '', kioskEasProjectId: '',
    },
    tokens: {}, copy: {}, features: {}, ...locationFields,
  };
}

describe('tenant locations compatibility', () => {
  it('normalizes legacy location into locations', () => {
    const result = parseTenantManifest(raw({ location: LOCATION }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.manifest.legacyLocation, true);
    assert.deepEqual(result.manifest.locations, [LOCATION]);
  });

  it('accepts multiple unique locations', () => {
    const second = { ...LOCATION, name: 'North' };
    const result = parseTenantManifest(raw({ locations: [LOCATION, second] }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.manifest.locations.map((location) => location.name), ['Main', 'North']);
  });

  it('rejects both shapes and duplicate location names', () => {
    const both = parseTenantManifest(raw({ location: LOCATION, locations: [LOCATION] }));
    assert.equal(both.kind, 'invalid');
    const duplicates = parseTenantManifest(raw({ locations: [LOCATION, { ...LOCATION, name: 'main' }] }));
    assert.equal(duplicates.kind, 'invalid');
  });
});
