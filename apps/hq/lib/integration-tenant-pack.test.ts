import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { validateIntegrationTenantPack } from './integration-tenant-pack';

const fixture = join(process.cwd(), '..', '..', 'tests/consistency/fixtures/elevate-pack/elevate-web-demo');
const fixtureFiles = [
  'brand.json', 'modules.json', 'operations.json', 'packs.json', 'release.json',
  'training-profile.json', 'README.md', 'assets/.gitkeep', 'services.json', 'brand-kit.json',
  'modules/mcp-store.json', 'modules/web-services/config.json',
];

const base = {
  brandId: '00000000-0000-4000-8000-0000000000aa',
  slug: 'elevate-web-demo',
  revision: 2,
  sourceRepo: 'owner/repository',
  sourceCommit: 'a'.repeat(40),
  files: Object.fromEntries(
    fixtureFiles.map((path) => [path, readFileSync(join(fixture, path), 'utf8')]),
  ),
};

describe('validateIntegrationTenantPack', () => {
  it('accepts a complete services-free administrative pack', () => {
    assert.equal(validateIntegrationTenantPack(base).kind, 'ok');
  });

  it('returns actionable issues for a partial or mismatched pack', () => {
    const result = validateIntegrationTenantPack({
      ...base,
      files: { ...base.files, 'release.json': '{"schemaVersion":2,"tenantSlug":"wrong"}' },
    });
    assert.equal(result.kind, 'invalid');
    if (result.kind === 'invalid') assert.ok(result.issues.some((issue) => /tenantSlug/.test(issue)));
  });

  it('refuses traversal paths and incomplete service groups', () => {
    const { 'brand-kit.json': _brandKit, ...withoutBrandKit } = base.files;
    const result = validateIntegrationTenantPack({
      ...base,
      files: { ...withoutBrandKit, '../workflow.yml': 'bad', 'services.json': '{}' },
    });
    assert.equal(result.kind, 'invalid');
    if (result.kind === 'invalid') {
      assert.ok(result.issues.some((issue) => /unsafe path/.test(issue)));
      assert.ok(result.issues.some((issue) => /sent together/.test(issue)));
    }
  });
});
