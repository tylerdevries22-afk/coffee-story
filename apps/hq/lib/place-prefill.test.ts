import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_HOURS, editedField, googleFieldsOf, MANUAL_PREFILL, needsConfirmation, placeCoordinates,
  prefillFromPlace, timezoneOptions, TIMEZONES,
} from './place-prefill';
import type { PlaceDraft } from './place-to-draft';

function draft(overrides: Partial<PlaceDraft> = {}): PlaceDraft {
  return {
    googlePlaceId: 'ChIJHarborRoast0001', name: 'Harbor Roast',
    street: '12 Pier Street', city: 'Tacoma', region: 'WA', postal: '98402',
    timezone: 'America/Los_Angeles', phone: '+1 253-555-0142', website: 'https://harbor-roast.example.com/',
    lat: 47.2529, lng: -122.4443, hours: { mon: [{ open: '07:00', close: '15:00' }] },
    industry: { key: 'coffee-shop', confidence: 'high', reason: 'Google lists it as “coffee shop”.' },
    warnings: [],
    ...overrides,
  };
}

describe('the fields a place fills', () => {
  it('marks every field Google gave a value', () => {
    assert.deepEqual([...googleFieldsOf(draft())].sort(), [
      'city', 'hours', 'industry', 'locationName', 'name', 'phone', 'postal', 'region', 'street',
      'timezone', 'website',
    ]);
  });

  it('never marks a field Google left empty', () => {
    const fields = googleFieldsOf(draft({ phone: null, website: null, hours: null, street: null }));
    for (const field of ['phone', 'website', 'hours', 'street'] as const) assert.equal(fields.has(field), false, field);
    assert.equal(fields.has('city'), true);
  });

  it('hands a field back to the operator the moment it is edited, and only that field', () => {
    const prefill = prefillFromPlace(draft(), 1);
    const edited = editedField(prefill, 'street');
    assert.equal(edited.fromGoogle.has('street'), false);
    assert.equal(edited.fromGoogle.has('city'), true);
    assert.equal(prefill.fromGoogle.has('street'), true, 'the earlier prefill is not mutated');
    assert.equal(editedField(edited, 'street'), edited, 'an already-edited field changes nothing');
  });

  it('remounts the inputs for each pick, even of the same place', () => {
    assert.notEqual(prefillFromPlace(draft(), 1).key, prefillFromPlace(draft(), 2).key);
    assert.equal(MANUAL_PREFILL.draft, null);
    assert.equal(MANUAL_PREFILL.fromGoogle.size, 0);
  });
});

describe('the map pin', () => {
  it('posts the listing’s coordinates while its address stands', () => {
    assert.deepEqual(placeCoordinates(prefillFromPlace(draft(), 1)), { lat: '47.2529', lng: '-122.4443' });
  });

  it('drops them once the operator rewrites any part of the address Google gave', () => {
    const prefill = prefillFromPlace(draft(), 1);
    for (const field of ['street', 'city', 'region', 'postal'] as const) {
      assert.deepEqual(placeCoordinates(editedField(prefill, field)), { lat: '', lng: '' }, field);
    }
    assert.deepEqual(placeCoordinates(editedField(prefill, 'phone')), { lat: '47.2529', lng: '-122.4443' });
  });

  it('keeps them when the operator only fills in a part Google left empty', () => {
    const prefill = prefillFromPlace(draft({ street: null }), 1);
    assert.deepEqual(placeCoordinates(editedField(prefill, 'street')), { lat: '47.2529', lng: '-122.4443' });
  });

  it('has none to give for a listing without a pin, or a business typed by hand', () => {
    assert.deepEqual(placeCoordinates(prefillFromPlace(draft({ lat: null, lng: null }), 1)), { lat: '', lng: '' });
    assert.deepEqual(placeCoordinates(MANUAL_PREFILL), { lat: '', lng: '' });
  });
});

describe('what the form starts from', () => {
  it('offers a place’s own time zone even when the list lacks it', () => {
    assert.equal(timezoneOptions('America/Los_Angeles'), TIMEZONES);
    assert.deepEqual(timezoneOptions('America/Boise'), ['America/Boise', ...TIMEZONES]);
    assert.equal(timezoneOptions(null), TIMEZONES);
  });

  it('opens a location typed by hand on weekdays, 08:00–17:00', () => {
    assert.deepEqual(Object.keys(DEFAULT_HOURS), ['mon', 'tue', 'wed', 'thu', 'fri']);
    assert.deepEqual(DEFAULT_HOURS.fri, [{ open: '08:00', close: '17:00' }]);
  });
});

describe('a closed business', () => {
  it('waits for the operator only when Google says it closed for good', () => {
    assert.equal(needsConfirmation(draft({ warnings: [{ code: 'closed_permanently', message: 'x' }] })), true);
    assert.equal(needsConfirmation(draft({ warnings: [{ code: 'closed_temporarily', message: 'x' }] })), false);
    assert.equal(needsConfirmation(draft()), false);
  });
});
