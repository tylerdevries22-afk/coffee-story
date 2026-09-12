import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseTenantManifest } from '../../../packages/tenant-config/src/index.js';
import { parseTenantModulesManifest } from '../../../packages/module-kit/src/modules-manifest.js';
import { modulesManifestProblems } from '../../../scripts/onboard-modules-manifest.js';

const ROOT = join(process.cwd(), '..', '..');
const TENANT_DIR = join(ROOT, 'tenants', 'stillpoint-builders');
/** The catalog side files every sibling and the template carry and this tenant does not. */
const OPTIONAL_CATALOG_FILES = ['menu-categories.json', 'modifiers.json', 'packs.json'];

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

  /**
   * Stillpoint ships menu.csv but none of the three catalog side files. The
   * loader reads each as empty when absent -- nothing is borrowed from another
   * tenant -- and the template has to say so, or the next franchisor-kind
   * tenant copies files it does not need and edits a coffee shop's option
   * groups. onboard-cli.test.ts proves the onboarding itself; this pins the
   * two facts that make leaving the files out a documented choice.
   */
  it('omits the optional catalog files, which the loader tolerates and the template documents', () => {
    assert.deepEqual(OPTIONAL_CATALOG_FILES.filter((name) => existsSync(join(TENANT_DIR, name))), []);
    const loader = readFileSync(join(ROOT, 'scripts', 'lib', 'onboard-validation.ts'), 'utf8');
    assert.match(loader, /function readModifiers[\s\S]*?if \(!existsSync\(path\)\) return \{\};/);
    assert.match(loader, /existsSync\(categoriesPath\)\s*\?[\s\S]*?: \[\]/);
    assert.match(loader, /readOptionalObjectFile\(join\(input\.tenantDir, 'packs\.json'\)/);
    const readme = readFileSync(join(ROOT, 'tenants', '_template', 'README.md'), 'utf8');
    assert.match(readme, /Optional files: `menu-categories\.json`, `modifiers\.json` and `packs\.json`/,
      'the template must say which catalog files a tenant may leave out');
    assert.match(readme, /nothing is ever borrowed from another tenant/);
  });
});
