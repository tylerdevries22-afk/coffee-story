import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { tenantArtifactDigest } from './artifact-binding';

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tenant-release-'));
  mkdirSync(join(directory, 'modules'));
  writeFileSync(join(directory, 'brand.json'), '{"name":"Juniper"}\n');
  writeFileSync(join(directory, 'modules', 'catalog.json'), '{"enabled":true}\n');
  return directory;
}

describe('tenantArtifactDigest', () => {
  it('changes when a releasable artifact changes', () => {
    const directory = fixture();
    const before = tenantArtifactDigest(directory);
    writeFileSync(join(directory, 'brand.json'), '{"name":"Juniper Two"}\n');
    assert.notEqual(tenantArtifactDigest(directory), before);
  });

  it('excludes release.json so its binding is not circular', () => {
    const directory = fixture();
    const before = tenantArtifactDigest(directory);
    writeFileSync(join(directory, 'release.json'), '{"evidence":"new"}\n');
    assert.equal(tenantArtifactDigest(directory), before);
  });
});
