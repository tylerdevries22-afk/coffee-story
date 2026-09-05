import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseTenantManifest } from '../../../packages/tenant-config/src/index.js';
import { parseTenantModulesManifest } from '../../../packages/module-kit/src/modules-manifest.js';
import { modulesManifestProblems } from '../../../scripts/onboard-modules-manifest.js';

const TENANT_DIR = join(process.cwd(), '..', '..', 'tenants', 'stillpoint-builders');

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
});
