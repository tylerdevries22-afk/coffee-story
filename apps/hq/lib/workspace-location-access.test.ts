import assert from 'node:assert/strict';
import test from 'node:test';

import type { TenantClaims } from '@platform/schema';

import { mayManageWorkspaceLocation, visibleWorkspaceLocations } from './workspace-location-access';

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const FIRST = '33333333-3333-4333-8333-333333333333';
const SECOND = '44444444-4444-4444-8444-444444444444';
const locations = [{ id: FIRST }, { id: SECOND }];

function claims(role: TenantClaims['role'], locationIds: string[] = []): TenantClaims {
  return { brand_id: BRAND, role, location_ids: locationIds };
}

test('restricted staff see only assigned switcher locations', () => {
  assert.deepEqual(visibleWorkspaceLocations(locations, claims('location_manager', [SECOND])), [{ id: SECOND }]);
});

test('owners and platform admins retain brand-wide location visibility', () => {
  assert.deepEqual(visibleWorkspaceLocations(locations, claims('brand_owner')), locations);
  assert.deepEqual(visibleWorkspaceLocations(locations, claims('platform_admin')), locations);
});

test('missing claims fail closed', () => {
  assert.deepEqual(visibleWorkspaceLocations(locations, null), []);
});

test('management controls require the claims home tenant and location access', () => {
  const owner = claims('platform_admin');
  assert.equal(mayManageWorkspaceLocation(BRAND, owner, FIRST), true);
  assert.equal(mayManageWorkspaceLocation(OTHER_BRAND, owner, FIRST), false);
  assert.equal(mayManageWorkspaceLocation(BRAND, claims('staff', [SECOND]), FIRST), false);
});
