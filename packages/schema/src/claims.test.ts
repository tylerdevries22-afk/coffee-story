import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canManageLocation, isStaffRole, parseTenantClaims } from './claims';

const BRAND = '11111111-2222-3333-4444-555555555555';
const LOC = '99999999-8888-7777-6666-555555555555';

describe('parseTenantClaims', () => {
  it('accepts a staff claim with locations', () => {
    const claims = parseTenantClaims({ brand_id: BRAND, location_ids: [LOC], role: 'staff' });
    assert.deepEqual(claims, { brand_id: BRAND, location_ids: [LOC], role: 'staff' });
  });

  it('accepts a customer claim: brand, no role', () => {
    const claims = parseTenantClaims({ brand_id: BRAND });
    assert.deepEqual(claims, { brand_id: BRAND, location_ids: [] });
    assert.equal(isStaffRole(claims), false);
  });

  it('fails closed on a malformed brand id', () => {
    assert.equal(parseTenantClaims({ brand_id: 'not-a-uuid', role: 'staff' }), null);
  });

  it('fails closed on a malformed location id rather than dropping it', () => {
    // Dropping a bad entry would silently shrink a manager's scope; a claim
    // that is wrong anywhere is wrong everywhere.
    assert.equal(parseTenantClaims({ brand_id: BRAND, location_ids: [LOC, 'oops'] }), null);
  });

  it('fails closed on an unknown role', () => {
    assert.equal(parseTenantClaims({ brand_id: BRAND, role: 'superuser' }), null);
  });

  it('rejects non-objects', () => {
    assert.equal(parseTenantClaims(null), null);
    assert.equal(parseTenantClaims('x'), null);
  });
});

describe('canManageLocation', () => {
  it('scopes staff to their own locations', () => {
    const staff = parseTenantClaims({ brand_id: BRAND, location_ids: [LOC], role: 'staff' });
    assert.equal(canManageLocation(staff, LOC), true);
    assert.equal(canManageLocation(staff, BRAND), false);
  });

  it('gives owners the whole brand', () => {
    const owner = parseTenantClaims({ brand_id: BRAND, role: 'brand_owner' });
    assert.equal(canManageLocation(owner, LOC), true);
  });

  it('gives customers nothing', () => {
    assert.equal(canManageLocation(parseTenantClaims({ brand_id: BRAND }), LOC), false);
  });
});
