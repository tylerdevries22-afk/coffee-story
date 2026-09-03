import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  parseTenantModulesManifest,
} from '../../../packages/module-kit/src/modules-manifest.ts';
import { MODULE_REGISTRY } from '../../../packages/module-kit/src/registry.ts';
import { resolveModules } from '../../../packages/module-kit/src/resolve.ts';
import { modulesManifestProblems } from '../../../scripts/onboard-modules-manifest.ts';

const ROOT = join(process.cwd(), '..', '..');
const TENANTS = join(ROOT, 'tenants');

/** Every tenant folder, the template included: it is validated like the rest. */
function tenantSlugs(): string[] {
  return readdirSync(TENANTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(TENANTS, entry.name, 'brand.json')))
    .map((entry) => entry.name)
    .sort();
}

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

  it('reports a config artifact the manifest names but the tenant does not ship', async () => {
    const dir = await tenantDir({
      'modules.json': JSON.stringify({
        schemaVersion: 1,
        modules: [{ key: 'commerce-catalog', version: '1.0.0', config: 'modules/absent.json' }],
      }),
    });
    try {
      assert.deepEqual(modulesManifestProblems(dir), [
        'modules.json: modules[0].config "modules/absent.json" is not a file in this tenant folder',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a version the registry does not ship and a surface the module never serves', async () => {
    const dir = await tenantDir({
      'modules.json': JSON.stringify({
        schemaVersion: 1,
        modules: [{ key: 'workforce-operations', version: '2.0.0', surfaces: ['customer'] }],
      }),
    });
    try {
      const problems = modulesManifestProblems(dir);
      assert.equal(problems.length, 2, JSON.stringify(problems));
      assert.match(problems[0] ?? '', /pins 2\.0\.0, but the registry ships "workforce-operations" at 1\.0\.0/);
      assert.match(problems[1] ?? '', /names "customer", which "workforce-operations" does not serve/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a module the registry has never heard of', async () => {
    const dir = await tenantDir({
      'modules.json': JSON.stringify({
        schemaVersion: 1,
        modules: [{ key: 'commerce-hoverboard', version: '1.0.0' }],
      }),
    });
    try {
      assert.deepEqual(modulesManifestProblems(dir), [
        'modules.json: "commerce-hoverboard" is not a module the platform ships',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The manifests actually shipped, checked the way onboarding checks them.
 *
 * A manifest that parses is not a manifest that works: parseTenantModulesManifest
 * validates authored shape and knows nothing of the registry, so an install can
 * name a module the platform does not ship, or depend on one that is missing,
 * and still read as valid. Resolution is what proves the declared set can be
 * turned into a running one -- and a config path is a promise about a file, so
 * it is checked against the disk rather than the string.
 */
describe('every tenant modules.json on disk', () => {
  it('finds the tenants it is meant to guard', () => {
    // Without this the suite below passes vacuously the day the layout moves.
    const slugs = tenantSlugs();
    assert.ok(slugs.includes('_template'), `tenant folders: ${slugs.join(', ')}`);
    assert.ok(slugs.length >= 4, `only ${slugs.length} tenant folders found`);
  });

  for (const slug of tenantSlugs()) {
    const path = join(TENANTS, slug, 'modules.json');

    it(`${slug} parses, resolves, and points only at files it ships`, () => {
      assert.ok(existsSync(path), `tenants/${slug}/modules.json is missing`);
      const result = parseTenantModulesManifest(JSON.parse(readFileSync(path, 'utf8')));
      assert.equal(result.kind, 'ok', `tenants/${slug}: ${JSON.stringify(result)}`);
      if (result.kind !== 'ok') return;

      const keys = result.manifest.modules.map((install) => install.key);
      const resolution = resolveModules(MODULE_REGISTRY, keys);
      assert.equal(resolution.kind, 'ok', `tenants/${slug}: ${JSON.stringify(resolution)}`);

      for (const install of result.manifest.modules) {
        if (install.config === null) continue;
        assert.ok(existsSync(join(TENANTS, slug, install.config)),
          `tenants/${slug}/modules.json names ${install.config}, which is not on disk`);
      }
    });

    it(`${slug} raises no onboarding problem`, () => {
      assert.deepEqual(modulesManifestProblems(join(TENANTS, slug)), []);
    });
  }
});
