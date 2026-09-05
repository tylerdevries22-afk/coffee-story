import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { tenantReleaseSurfacePlan } from './release-surfaces';

describe('tenantReleaseSurfacePlan', () => {
  const tenants = fileURLToPath(new URL('../tenants/', import.meta.url));

  it('deploys all five tenant-driven applications for Stillpoint Builders', () => {
    const plan = tenantReleaseSurfacePlan(`${tenants}stillpoint-builders`, 'stillpoint-builders');
    assert.deepEqual(plan.all, ['hq', 'display', 'customer', 'operator', 'kiosk']);
    assert.deepEqual(plan.web, ['display', 'customer', 'operator', 'kiosk']);
    assert.deepEqual(plan.native, ['customer', 'operator', 'kiosk']);
    assert.equal(plan.failClosed, false);
  });

  it('keeps every application used by Coffee Story', () => {
    const plan = tenantReleaseSurfacePlan(`${tenants}coffee-story`, 'coffee-story');
    assert.deepEqual(plan.all, ['hq', 'display', 'customer', 'operator', 'kiosk']);
  });

  it('fails closed to every surface when declaration is unavailable', () => {
    const plan = tenantReleaseSurfacePlan(`${tenants}missing-tenant`, 'missing-tenant');
    assert.deepEqual(plan.all, ['hq', 'display', 'customer', 'operator', 'kiosk']);
    assert.equal(plan.failClosed, true);
    assert.ok(plan.issues.some((issue) => /brand\.json is required/.test(issue)));
  });

  it('fails closed when a declaration omits an enabled module surface', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-surfaces-'));
    writeFileSync(join(directory, 'brand.json'), JSON.stringify({
      identity: { slug: 'test-tenant' }, surfaces: ['hq'],
    }));
    writeFileSync(join(directory, 'modules.json'), JSON.stringify({
      schemaVersion: 1,
      modules: [{ key: 'construction-projects', version: '1.0.0', enabled: true }],
    }));
    const plan = tenantReleaseSurfacePlan(directory, 'test-tenant');
    assert.equal(plan.failClosed, true);
    assert.deepEqual(plan.all, ['hq', 'display', 'customer', 'operator', 'kiosk']);
    assert.ok(plan.issues.some((issue) => issue.includes('operator')));
  });

  it('fails closed when brand identity does not match the requested tenant', () => {
    const directory = mkdtempSync(join(tmpdir(), 'release-surfaces-'));
    writeFileSync(join(directory, 'brand.json'), JSON.stringify({
      identity: { slug: 'other-tenant' }, surfaces: ['hq'],
    }));
    writeFileSync(join(directory, 'modules.json'), JSON.stringify({ schemaVersion: 1, modules: [] }));
    const plan = tenantReleaseSurfacePlan(directory, 'test-tenant');
    assert.equal(plan.failClosed, true);
    assert.ok(plan.issues.some((issue) => issue.includes('identity.slug')));
  });
});
