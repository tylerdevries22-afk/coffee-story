import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLocationDraft, type LocationInput } from './location-input';
import { locationInputFromForm } from './org-form-input';
import { provisioningLocation } from './provisioning-location';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

const HOURS = { mon: [{ open: '07:00', close: '15:00' }], fri: [{ open: '18:00', close: '01:00' }] };

/** What the wizard posts after a Google pick. */
const PICKED = {
  locationName: 'Harbor Roast', street: '12 Pier Street', city: 'Tacoma', region: 'WA', postal: '98402',
  timezone: 'America/Los_Angeles', hours: JSON.stringify(HOURS),
  googlePlaceId: 'ChIJHarborRoast0001', lat: '47.2529', lng: '-122.4443',
  phone: '+1 253-555-0142', website: 'https://harbor-roast.example.com/',
};

/** As supabase-js sends it: JSON, so an undefined key is simply absent. */
function sent(input: LocationInput): unknown {
  const parsed = parseLocationDraft(input);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  return JSON.parse(JSON.stringify(provisioningLocation(parsed.draft)));
}

describe('the first location, as provisioning reads it', () => {
  it('carries the parsed Place id, map pin, phone and website into p_location', () => {
    assert.deepEqual(sent(locationInputFromForm(form(PICKED))), {
      name: 'Harbor Roast',
      address: {
        street: '12 Pier Street', city: 'Tacoma', region: 'WA', postal: '98402',
        lat: 47.2529, lng: -122.4443,
      },
      hours: HOURS,
      timezone: 'America/Los_Angeles',
      googlePlaceId: 'ChIJHarborRoast0001',
      phone: '+1 253-555-0142',
      website: 'https://harbor-roast.example.com/',
    });
  });

  it('keeps the pin inside the address, as numbers, never as its own keys', () => {
    const location = sent(locationInputFromForm(form(PICKED))) as Record<string, unknown>;
    assert.equal('lat' in location, false);
    assert.equal('lng' in location, false);
    assert.equal(typeof (location.address as Record<string, unknown>).lat, 'number');
  });

  it('sends explicit nulls and no pin for a location typed by hand', () => {
    const byHand = { ...PICKED, googlePlaceId: '', lat: '', lng: '', phone: '', website: '', street: '' };
    assert.deepEqual(sent(locationInputFromForm(form(byHand))), {
      name: 'Harbor Roast',
      address: { city: 'Tacoma', region: 'WA', postal: '98402' },
      hours: HOURS,
      timezone: 'America/Los_Angeles',
      googlePlaceId: null,
      phone: null,
      website: null,
    });
  });

  it('leaves the display-only summary and the copied city behind', () => {
    const location = sent(locationInputFromForm(form(PICKED))) as Record<string, unknown>;
    assert.equal('hoursSummary' in location, false);
    assert.equal('city' in location, false);
  });

  it('sends no location for an organization that has none', () => {
    assert.equal(provisioningLocation(null), null);
  });
});
