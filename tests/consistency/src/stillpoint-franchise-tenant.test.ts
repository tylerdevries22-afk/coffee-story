import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseTenantManifest } from '../../../packages/tenant-config/src/index.js';
import { parseTenantModulesManifest } from '../../../packages/module-kit/src/modules-manifest.js';
import { modulesManifestProblems } from '../../../scripts/onboard-modules-manifest.js';

const ROOT = join(process.cwd(), '..', '..');
const TENANT_DIR = join(ROOT, 'tenants', 'stillpoint-builders');
const STANDARD_CATALOG_FILES = ['menu-categories.json', 'modifiers.json', 'packs.json'];

function json(name: string): unknown {
  return JSON.parse(readFileSync(join(TENANT_DIR, name), 'utf8')) as unknown;
}

describe('Stillpoint Builders franchise tenant', () => {
  it('declares every product surface and two construction operating locations', () => {
    const parsed = parseTenantManifest(json('brand.json'));
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.deepEqual(new Set(parsed.manifest.surfaces), new Set([
      'hq', 'display', 'customer', 'operator', 'kiosk',
    ]));
    assert.deepEqual(parsed.manifest.locations.map((location) => location.name), [
      'Denver Regional Office', 'Colorado Springs Field Office',
    ]);
    assert.equal(parsed.manifest.business?.industry, 'Construction and renovation');
  });

  it('installs the complete strict registry-backed construction capability set', () => {
    const parsed = parseTenantModulesManifest(json('modules.json'));
    assert.equal(parsed.kind, 'ok');
    if (parsed.kind !== 'ok') return;
    assert.deepEqual(parsed.manifest.modules.map((module) => module.key), [
      'construction-projects', 'workforce-operations', 'workforce-training',
      'commerce-catalog', 'commerce-ordering', 'commerce-payments', 'local-printing',
      'device-wall',
    ]);
    assert.deepEqual(modulesManifestProblems(TENANT_DIR), []);
  });

  it('carries the complete commerce group its commerce-catalog module declares', () => {
    assert.deepEqual(
      STANDARD_CATALOG_FILES.filter((name) => existsSync(join(TENANT_DIR, name))),
      STANDARD_CATALOG_FILES,
    );
    const loader = readFileSync(join(ROOT, 'scripts', 'lib', 'onboard-validation.ts'), 'utf8');
    assert.match(loader, /function readModifiers[\s\S]*?if \(!existsSync\(path\)\) return \{\};/);
    assert.match(loader, /existsSync\(categoriesPath\)\s*\?[\s\S]*?: \[\]/);
    assert.match(loader, /readOptionalObjectFile\(join\(input\.tenantDir, 'packs\.json'\)/);
    const readme = readFileSync(join(ROOT, 'tenants', '_template', 'README.md'), 'utf8');
    assert.match(readme, /declares `commerce-catalog` must carry the complete commerce group/,
      'the template must bind the commerce group to the module declaration');
    assert.match(readme, /Nothing is ever borrowed from another\s+tenant/);
  });
});
