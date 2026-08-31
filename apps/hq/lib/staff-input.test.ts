import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseStaffDraft } from './staff-input';

const LOCATION = '11111111-1111-4111-8111-111111111111';

describe('parseStaffDraft', () => {
  it('normalizes an invite and preserves a bounded location scope', () => {
    assert.deepEqual(parseStaffDraft({
      email: ' Owner@Example.COM ', locationIds: [LOCATION], role: 'staff',
    }), {
      ok: true,
      draft: { email: 'owner@example.com', locationIds: [LOCATION], role: 'staff' },
    });
  });

  it('keeps owners brand-wide and refuses platform role assignment', () => {
    assert.deepEqual(parseStaffDraft({
      email: 'owner@example.com', locationIds: [LOCATION], role: 'brand_owner',
    }), {
      ok: true,
      draft: { email: 'owner@example.com', locationIds: [], role: 'brand_owner' },
    });
    assert.equal(parseStaffDraft({
      email: 'root@example.com', locationIds: [], role: 'platform_admin',
    }).ok, false);
  });

  it('requires scoped roles to name only unique valid locations', () => {
    assert.equal(parseStaffDraft({
      email: 'staff@example.com', locationIds: [], role: 'staff',
    }).ok, false);
    assert.equal(parseStaffDraft({
      email: 'staff@example.com', locationIds: [LOCATION, LOCATION], role: 'staff',
    }).ok, false);
  });
});
