import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveActivityBoardConfig } from '@platform/domain';
import { demoOperationsEnabled, selectedDemoTenant, usesLaunchDemoFixtures } from './demo-tenant';

describe('selectedDemoTenant', () => {
  it('hydrates Stillpoint preview behavior from its tenant folder', () => {
    const tenant = selectedDemoTenant('stillpoint-builders');
    assert.ok(tenant);
    assert.equal(tenant.brandName, 'Stillpoint Builders');
    assert.equal(tenant.locations[0]?.name, 'Denver Regional Office');
    assert.equal(resolveActivityBoardConfig(tenant.brandConfig).enabled, true);
    assert.equal(tenant.moduleKeys.includes('workforce-operations'), true);
    assert.equal(demoOperationsEnabled('stillpoint-builders'), true);
  });

  it('keeps the standard operator demo when no tenant was selected', () => {
    assert.equal(selectedDemoTenant('coffee-story'), null);
  });

  it('does not borrow the standard demo for an unknown explicit tenant', () => {
    const tenant = selectedDemoTenant('new-neutral-tenant');
    assert.ok(tenant);
    assert.equal(tenant.brandName, 'Base App');
    assert.deepEqual(tenant.locations, [{ id: 'loc-base', name: 'Main', timezone: 'UTC' }]);
    assert.equal(resolveActivityBoardConfig(tenant.brandConfig).enabled, false);
    assert.deepEqual(tenant.moduleKeys, []);
    assert.equal(demoOperationsEnabled('new-neutral-tenant'), false);
    assert.equal(usesLaunchDemoFixtures('new-neutral-tenant'), false);
  });
});
