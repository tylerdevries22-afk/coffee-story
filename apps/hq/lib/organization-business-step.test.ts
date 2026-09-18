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

  it('refuses a span that opens and closes at the same minute, and targets the closing time', () => {
    assert.deepEqual(businessStepOf(business({ openTime: '08:00', closeTime: '08:00' })), {
      ok: false, field: 'closeTime',
      error: 'Opening and closing times can’t be the same. For a location that never closes, use 00:00 to 23:59.',
    });
  });

  it('accepts a close before the open as an overnight span', () => {
    const result = businessStepOf(business({ openTime: '17:00', closeTime: '01:00' }));
    assert.ok(result.ok);
    assert.equal(result.details.hours, 'Mon Tue 17:00–01:00');
  });

  it('summarizes per-day hours from the wizard over the quick form', () => {
    const hours = JSON.stringify({ mon: [{ open: '07:00', close: '15:00' }], sat: [{ open: '00:00', close: '23:59' }] });
    const result = businessStepOf(business({ hours }));
    assert.ok(result.ok);
    assert.equal(result.details.hours, 'Mon 07:00–15:00 · Sat 24 hours');
  });

  it('checks the website before submitting, for every organization model', () => {
    for (const organizationKind of ['independent', 'franchisor'] as const) {
      assert.deepEqual(businessStepOf(business({ organizationKind, website: 'http://juniper.example.com' })), {
        ok: false, field: 'website', error: 'Enter the website as a public https:// address.',
      });
    }
    assert.ok(businessStepOf(business({ website: 'https://juniper.example.com/' })).ok);
  });

  it('targets the field a Google-filled value failed on', () => {
    assert.deepEqual(businessStepOf(business({ phone: 'n/a' })), {
      ok: false, field: 'phone', error: 'Enter a phone number with 7 to 15 digits.',
    });
    const hours = JSON.stringify({ fri: [{ open: '08:00', close: '14:00' }, { open: '12:00', close: '18:00' }] });
    const overlapping = businessStepOf(business({ hours }));
    assert.equal(overlapping.ok, false);
    if (!overlapping.ok) assert.equal(overlapping.field, 'hours');
  });
});
