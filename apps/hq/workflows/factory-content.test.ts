import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { factoryContentSnapshot, nextContentArtifactVersion } from './factory-content';

describe('factoryContentSnapshot', () => {
  it('binds an authoritative release to its tenant and immutable version', () => {
    assert.deepEqual(factoryContentSnapshot({
      id: 'release-1', version: 3, manifest: { schemaVersion: 1, nodes: [] },
    }, 'stillpoint-builders'), {
      manifest: {
        tenantSlug: 'stillpoint-builders', releaseId: 'release-1', releaseVersion: 3,
        release: { schemaVersion: 1, nodes: [] },
      },
    });
  });

  it('advances immutable ledger versions only for a different release', () => {
    assert.equal(nextContentArtifactVersion(null, 'release-1'), 1);
    assert.equal(nextContentArtifactVersion({
      version: 4, manifest: { releaseId: 'release-1' },
    }, 'release-1'), null);
    assert.equal(nextContentArtifactVersion({
      version: 4, manifest: { releaseId: 'release-1' },
    }, 'release-2'), 5);
  });

  it('rejects absent, malformed, or non-versioned releases', () => {
    assert.equal(factoryContentSnapshot(null, 'tenant'), null);
    assert.equal(factoryContentSnapshot({ id: 'bad', version: 0, manifest: {} }, 'tenant'), null);
    assert.equal(factoryContentSnapshot({ id: 'bad', version: 1, manifest: [] }, 'tenant'), null);
  });
});
