import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { businessStepOf } from './organization-business-step';

function business(overrides: Record<string, string | readonly string[]> = {}) {
  const data = new FormData();
  const values = {
    name: 'Juniper Base Demo', organizationKind: 'independent', ownerEmail: 'owner@example.com',
    locationName: 'Main location', city: 'Riverside', timezone: 'America/Denver',
    openTime: '08:00', closeTime: '17:00', days: ['mon', 'tue'], ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

describe('businessStepOf', () => {
  it('builds the exact review summary from a valid business step', () => {
    assert.deepEqual(businessStepOf(business()), { ok: true, details: {
      ownerEmail: 'owner@example.com', location: 'Main location · Riverside',
      hours: 'Mon Tue 08:00–17:00', network: '', territory: '',
    } });
  });

  it('rejects a trimmed name below the server minimum and targets its input', () => {
    assert.deepEqual(businessStepOf(business({ name: ' ! ' })), {
      ok: false, field: 'name',
      error: 'Enter at least two letters or numbers for the organization name.',
    });
  });

  it('requires an open day and targets the checkbox group', () => {
    assert.deepEqual(businessStepOf(business({ days: [] })), {
      ok: false, field: 'days', error: 'Pick at least one day the location is open.',
    });
  });

  it('requires closing after opening and targets the closing time', () => {
    const invalidRanges = [['17:00', '08:00'], ['08:00', '08:00']] as const;
    for (const [openTime, closeTime] of invalidRanges) {
      assert.deepEqual(businessStepOf(business({ openTime, closeTime })), {
        ok: false, field: 'closeTime', error: 'Closing time has to be after opening time.',
      });
    }
  });
});
