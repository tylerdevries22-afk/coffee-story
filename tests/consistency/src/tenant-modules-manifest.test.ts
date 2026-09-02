import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { modulesManifestProblems } from '../../../scripts/onboard-modules-manifest.ts';

const ROOT = join(process.cwd(), '..', '..');

async function tenantDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tenant-modules-'));
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents);
  }
  return dir;
}

describe('onboarding modules.json validation', () => {
  it('reports nothing when the tenant has no modules.json', async () => {
    const dir = await tenantDir({});
    try {
      assert.deepEqual(modulesManifestProblems(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports nothing for a valid modules.json', async () => {
    const dir = await tenantDir({
      'modules.json': JSON.stringify({
        schemaVersion: 1,
        modules: [{ key: 'commerce-catalog', version: '1.0.0' }],
      }),
    });
    try {
      assert.deepEqual(modulesManifestProblems(dir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lists every parser issue, prefixed with the file name', async () => {
    const dir = await tenantDir({
      'modules.json': JSON.stringify({
        schemaVersion: 0,
        modules: [{ key: 'Bad Key', version: '1.0' }],
      }),
    });
    try {
      const problems = modulesManifestProblems(dir);
      assert.ok(problems.length >= 3, JSON.stringify(problems));
      assert.ok(problems.every((problem) => problem.startsWith('modules.json: ')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports unreadable JSON as one problem', async () => {
    const dir = await tenantDir({ 'modules.json': '{ not json' });
    try {
      assert.deepEqual(modulesManifestProblems(dir), ['modules.json must contain valid JSON.']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts the shipped tenants/_template/modules.json', () => {
    assert.deepEqual(modulesManifestProblems(join(ROOT, 'tenants', '_template')), []);
  });
});
