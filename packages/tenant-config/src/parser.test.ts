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

  it('rejects duplicate surfaces and provider capabilities', () => {
    const provider = { capability: 'database', provider: 'supabase', ownership: 'platform', required: true };
    const result = parseTenantManifest(base({ surfaces: ['hq', 'hq'], providers: [provider, provider] }));
    assert.equal(result.kind, 'invalid');
    if (result.kind !== 'invalid') return;
    assert.ok(result.issues.includes('surfaces must not repeat entries'));
    assert.ok(result.issues.some((issue) => issue.includes('capability must be unique')));
  });
});
