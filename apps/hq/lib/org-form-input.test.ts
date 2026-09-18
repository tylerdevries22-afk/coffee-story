import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orgInputFromForm } from './org-form-input';
import { parseOrgDraft } from './org-input';

function form(values: Record<string, string | readonly string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of typeof value === 'string' ? [value] : value) data.append(key, item);
  }
  return data;
}

const WIZARD = {
  name: 'Harbor Roast', ownerEmail: 'owner@harbor.example', organizationKind: 'independent',
  industryKey: 'coffee-shop', blueprintKey: 'coffee-shop',
  moduleKeys: ['commerce-catalog', 'commerce-ordering'], connectorIds: [],
  locationName: 'Harbor Roast', street: '12 Pier Street', city: 'Tacoma', region: 'WA', postal: '98402',
  timezone: 'America/Los_Angeles', website: 'https://harbor-roast.example.com/', phone: '+1 253-555-0142',
  googlePlaceId: 'ChIJHarborRoastExample01', lat: '47.2529', lng: '-122.4443',
  hours: JSON.stringify({ mon: [{ open: '07:00', close: '15:00' }], fri: [{ open: '18:00', close: '01:00' }] }),
};

describe('the new-organization form, read for the parsers', () => {
  it('carries every field the wizard posts, Google’s included', () => {
    const input = orgInputFromForm(form(WIZARD));
    assert.equal(input.website, 'https://harbor-roast.example.com/');
    assert.deepEqual(input.moduleKeys, ['commerce-catalog', 'commerce-ordering']);
    assert.deepEqual(input.location, {
      name: 'Harbor Roast', street: '12 Pier Street', city: 'Tacoma', region: 'WA', postal: '98402',
      timezone: 'America/Los_Angeles', hours: WIZARD.hours,
      googlePlaceId: 'ChIJHarborRoastExample01', lat: '47.2529', lng: '-122.4443',
      phone: '+1 253-555-0142', website: 'https://harbor-roast.example.com/',
    });
  });

  it('parses into a draft whose website reaches the factory and whose place rides with the location', () => {
    const parsed = parseOrgDraft(orgInputFromForm(form(WIZARD)));
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
    assert.equal(parsed.draft.website, 'https://harbor-roast.example.com/');
    assert.equal(parsed.draft.location?.googlePlaceId, 'ChIJHarborRoastExample01');
    assert.deepEqual(parsed.draft.location?.address, {
      street: '12 Pier Street', city: 'Tacoma', region: 'WA', postal: '98402', lat: 47.2529, lng: -122.4443,
    });
    assert.equal(parsed.draft.location?.hoursSummary, 'Mon 07:00–15:00 · Fri 18:00–01:00');
  });

  it('no longer reads the retired one-span form: without the week, the location is refused', () => {
    const quick = { ...WIZARD, hours: '', openTime: '08:00', closeTime: '17:00', days: ['mon', 'tue'] };
    const parsed = parseOrgDraft(orgInputFromForm(form(quick)));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error, 'The hours could not be read. Reload the form and try again.');
  });

  it('reads an absent field as empty, never as the string "null"', () => {
    const input = orgInputFromForm(form({ name: 'Harbor Roast' }));
    assert.equal(input.website, '');
    assert.equal(input.location?.hours, '');
    assert.equal(input.location?.googlePlaceId, '');
  });
});
