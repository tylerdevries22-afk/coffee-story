import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { tenantArtifactDigest } from '../artifact-binding';
import { buildTenantPackage } from './builder';

const roots: string[] = [];
const run = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

function repository(): { root: string; tenant: string } {
  const root = mkdtempSync(join(tmpdir(), 'tenant-package-build-'));
  roots.push(root);
  const tenant = join(root, 'tenants', 'neutral-demo');
  mkdirSync(tenant, { recursive: true });
  writeFileSync(join(tenant, 'brand.json'), '{"name":"Neutral Demo"}\n');
  run(root, 'init', '-q');
  run(root, 'config', 'user.email', 'test@example.test');
  run(root, 'config', 'user.name', 'Test');
  run(root, 'add', '.');
  run(root, 'commit', '-qm', 'payload');
  const sourceCommit = run(root, 'rev-parse', 'HEAD');
  const artifactDigest = tenantArtifactDigest(tenant);
  writeFileSync(join(tenant, 'release.json'), JSON.stringify({
    schemaVersion: 2, tenantSlug: 'neutral-demo',
    release: {
      releaseId: 'neutral-demo-2026-09-06.1', commitSha: sourceCommit,
      artifactDigest, createdAt: '2026-09-06T00:00:00.000Z',
    },
  }));
  run(root, 'add', '.');
  run(root, 'commit', '-qm', 'release envelope');
  return { root, tenant };
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('buildTenantPackage', () => {
  it('creates a deterministic archive bound to the immutable payload commit', async () => {
    const { root, tenant } = repository();
    const output = mkdtempSync(join(tmpdir(), 'tenant-package-output-'));
    roots.push(output);
    const first = await buildTenantPackage({
      repositoryRoot: root, tenantRoot: tenant, tenantSlug: 'neutral-demo',
      archivePath: join(output, 'first.zip'), malwareScanner: () => {}, requireCi: false,
    });
    const second = await buildTenantPackage({
      repositoryRoot: root, tenantRoot: tenant, tenantSlug: 'neutral-demo',
      archivePath: join(output, 'second.zip'), malwareScanner: () => {}, requireCi: false,
    });
    assert.equal(first.artifactDigest, second.artifactDigest);
    assert.deepEqual(readFileSync(first.archivePath), readFileSync(second.archivePath));
    assert.match(first.archiveSha256, /^sha256:[0-9a-f]{64}$/);
  });

  it('rejects a dirty checkout and a payload changed after its bound commit', async () => {
    const { root, tenant } = repository();
    writeFileSync(join(tenant, 'draft.txt'), 'uncommitted');
    await assert.rejects(buildTenantPackage({
      repositoryRoot: root, tenantRoot: tenant, tenantSlug: 'neutral-demo',
      archivePath: join(root, 'dirty.zip'), malwareScanner: () => {}, requireCi: false,
    }), { code: 'checkout_dirty' });
  });
});
