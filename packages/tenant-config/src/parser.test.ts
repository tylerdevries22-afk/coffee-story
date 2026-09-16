import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseTenantManifest } from './parser';

function base(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    organization: { kind: 'independent' },
    network: null,
    inheritance: { mode: 'standalone', sourceTenantSlug: null, revision: 1, overrides: [] },
    surfaces: ['operator', 'hq'],
    providers: [
      { capability: 'database', provider: 'supabase', ownership: 'platform', required: true },
    ],
    identity: {
      slug: 'test-tenant', name: 'Test Tenant', bundleId: 'com.test.app', scheme: 'test',
      kioskBundleId: 'com.test.kiosk', kioskScheme: 'test-kiosk', easProjectId: '', kioskEasProjectId: '',
    },
    tokens: {}, copy: {}, features: {},
    ...extra,
  };
}

describe('parseTenantManifest', () => {
  it('accepts the strict v1 metadata contract', () => {
    const result = parseTenantManifest(base());
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.manifest.surfaces, ['operator', 'hq']);
    assert.equal(result.manifest.providers[0]?.provider, 'supabase');
  });

  it('rejects unknown versions and top-level fields', () => {
    const result = parseTenantManifest(base({ schemaVersion: 2, mystery: true }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.includes('schemaVersion must equal 1'));
    assert.ok(result.issues.includes('unsupported top-level field "mystery"'));
  });

  it('enforces franchise network and inheritance relationships', () => {
    const result = parseTenantManifest(base({ organization: { kind: 'franchisee' } }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.some((issue) => issue.includes('franchisee organizations require network')));
    assert.ok(result.issues.some((issue) => issue.includes('franchisees must declare network inheritance')));
  });

  // Elevate owns the pack schema and hosts the `admin` surface itself. A pack
  // naming it is well-formed here; what this repo BUILDS is a separate,
  // narrower set (FACTORY_SURFACES), applied by the consumers of a manifest
  // rather than by the parser.
  it('accepts a surface Elevate hosts and this repo does not build', () => {
    const result = parseTenantManifest(base({ surfaces: ['customer', 'admin', 'hq'] }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.deepEqual(result.manifest.surfaces, ['customer', 'admin', 'hq']);
  });

  // Socials are a top-level key rather than a `business` field: `business` is a
  // flat string record, and Elevate nests six social URLs under one object.
  // Loosening `business` to hold objects would weaken every other field in it.
  it('accepts socials as their own top-level key', () => {
    const socials = { instagram: 'https://example.com/i', linkedin: '' };
    const result = parseTenantManifest(base({ socials, business: { legalName: 'Test' } }));
    assert.equal(result.kind, 'ok');
  });

  it('still rejects a nested object inside business', () => {
    const result = parseTenantManifest(base({ business: { socials: { instagram: 'x' } } }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.includes('business must be an object of strings'));
  });

  // A Place id is the only field on a location that is an identity rather than
  // a description, so it is the only one worth validating beyond "is a string".
  it('accepts a location that names the Google Place it is', () => {
    const result = parseTenantManifest(base({
      locations: [{
        name: 'Lobby', timezone: 'America/Denver', address: {}, hours: {},
        googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      }],
    }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.manifest.locations[0]?.googlePlaceId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');
  });

  it('leaves googlePlaceId absent when the tenant names no Place', () => {
    const result = parseTenantManifest(base({
      locations: [{ name: 'Lobby', timezone: 'America/Denver', address: {}, hours: {} }],
    }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal('googlePlaceId' in (result.manifest.locations[0] ?? {}), false);
  });

  /**
   * `placeQuery` is the property named the way a person would name it, so a
   * lookup can resolve the id above. It exists because the alternative -- an
   * operator pasting an opaque id -- fails silently: an id pointing at the cafe
   * next door renders the cafe's hours under the hotel's name.
   */
  it('accepts a property named for a lookup, and trims it', () => {
    const result = parseTenantManifest(base({
      locations: [{
        name: 'Lobby', timezone: 'America/Denver', address: {}, hours: {},
        placeQuery: '  The Example Hotel, Georgetown CO  ',
      }],
    }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal(result.manifest.locations[0]?.placeQuery, 'The Example Hotel, Georgetown CO');
  });

  it('leaves placeQuery absent when the tenant names nothing to look up', () => {
    const result = parseTenantManifest(base({
      locations: [{ name: 'Lobby', timezone: 'America/Denver', address: {}, hours: {} }],
    }));
    assert.equal(result.kind, 'ok');
    if (result.kind !== 'ok') return;
    assert.equal('placeQuery' in (result.manifest.locations[0] ?? {}), false);
  });

  // It is free text posted to a metered provider, so the bound lives in the
  // manifest rather than at the call site: a pasted page should not become a
  // query, and an empty string should not become a lookup that matches anything.
  for (const bad of ['', '   ', 'x'.repeat(201)]) {
    it(`refuses a placeQuery that cannot resolve a property: ${JSON.stringify(bad.slice(0, 12))}`, () => {
      const result = parseTenantManifest(base({
        locations: [{
          name: 'Lobby', timezone: 'America/Denver', address: {}, hours: {}, placeQuery: bad,
        }],
      }));
      assert.equal(result.kind, 'invalid');
      if (result.kind !== 'invalid') return;
      assert.ok(result.issues.some((issue) => issue.includes('placeQuery must be')), result.issues.join('; '));
    });
  }

  // Anything that could smuggle a path, a quote or whitespace into a value the
  // database and a URL both handle is refused rather than stored and trusted.
  for (const bad of ['', 'has space', '../etc/passwd', 'quote"id', 'a'.repeat(256)]) {
    it(`refuses a Google Place id that is not one: ${JSON.stringify(bad)}`, () => {
      const result = parseTenantManifest(base({
        locations: [{
          name: 'Lobby', timezone: 'America/Denver', address: {}, hours: {}, googlePlaceId: bad,
        }],
      }));
      assert.equal(result.kind, 'invalid');
      if (result.kind !== 'invalid') return;
      assert.ok(result.issues.some((issue) => issue.includes('googlePlaceId must be a Google Place id')),
        result.issues.join('; '));
    });
  }

  it('rejects duplicate surfaces and provider capabilities', () => {
    const provider = { capability: 'database', provider: 'supabase', ownership: 'platform', required: true };
    const result = parseTenantManifest(base({ surfaces: ['hq', 'hq'], providers: [provider, provider] }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.includes('surfaces must not repeat entries'));
    assert.ok(result.issues.some((issue) => issue.includes('capability must be unique')));
  });
});
