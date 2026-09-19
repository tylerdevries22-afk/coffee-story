import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlaceDetails } from '@platform/engine';

import { parseLocationDraft } from './location-input';
import { placeToDraft } from './place-to-draft';

/** A normalized listing as the engine returns it. Invented; no key is used in tests. */
function listing(overrides: Partial<PlaceDetails> = {}): PlaceDetails {
  return {
    placeId: 'ChIJHarborRoastExample01',
    name: 'Harbor Roast',
    formattedAddress: '12 Pier St, Tacoma, WA 98402, USA',
    address: { street: '12 Pier St', city: 'Tacoma', region: 'WA', postal: '98402', country: 'US' },
    location: { lat: 47.2529, lng: -122.4443 },
    timeZone: 'America/Los_Angeles',
    rating: 4.6,
    userRatingCount: 212,
    websiteUri: 'https://harbor-roast.example.com/',
    phone: '+1 253-555-0142',
    weekdayDescriptions: ['Monday: 7:00 AM – 3:00 PM'],
    openingPeriods: [
      { openDay: 1, open: '07:00', closeDay: 1, close: '15:00' },
      { openDay: 5, open: '07:00', closeDay: 5, close: '15:00' },
      { openDay: 5, open: '18:00', closeDay: 6, close: '01:00' },
    ],
    photoNames: ['places/ChIJHarborRoastExample01/photos/abc'],
    types: ['coffee_shop', 'cafe', 'food', 'point_of_interest', 'establishment'],
    primaryType: 'coffee_shop',
    businessStatus: 'OPERATIONAL',
    mapsUri: 'https://maps.google.com/?cid=1',
    reviewsUri: 'https://www.google.com/maps/place//data=reviews',
    writeReviewUri: 'https://www.google.com/maps/place//data=write-review',
    ...overrides,
  };
}

describe('a Google listing as the wizard draft', () => {
  it('fills identity, address, contact, time zone, hours and industry', () => {
    assert.deepEqual(placeToDraft(listing()), {
      googlePlaceId: 'ChIJHarborRoastExample01',
      name: 'Harbor Roast',
      street: '12 Pier St', city: 'Tacoma', region: 'WA', postal: '98402',
      timezone: 'America/Los_Angeles',
      phone: '+1 253-555-0142',
      website: 'https://harbor-roast.example.com/',
      lat: 47.2529, lng: -122.4443,
      hours: {
        mon: [{ open: '07:00', close: '15:00' }],
        fri: [{ open: '07:00', close: '15:00' }, { open: '18:00', close: '01:00' }],
      },
      industry: { key: 'coffee-shop', confidence: 'high', reason: 'Google lists it as “coffee shop”.' },
      warnings: [],
    });
  });

  it('carries nothing the wizard does not use', () => {
    const draft = JSON.stringify(placeToDraft(listing()));
    for (const leftOut of ['photos', 'rating', 'data=reviews', 'write-review', 'maps.google.com']) {
      assert.equal(draft.includes(leftOut), false, leftOut);
    }
  });

  it('prefills values the form itself will accept', () => {
    const draft = placeToDraft(listing());
    const parsed = parseLocationDraft({
      name: draft.name, street: draft.street ?? '', city: draft.city ?? '', region: draft.region ?? '',
      postal: draft.postal ?? '', timezone: draft.timezone ?? '', hours: draft.hours,
      googlePlaceId: draft.googlePlaceId, lat: draft.lat ?? '', lng: draft.lng ?? '',
      phone: draft.phone ?? '', website: draft.website ?? '',
    });
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
    assert.equal(parsed.draft.hoursSummary, 'Mon 07:00–15:00 · Fri 07:00–15:00, 18:00–01:00');
  });

  it('warns about a permanently closed business instead of quietly filling it in', () => {
    const draft = placeToDraft(listing({ businessStatus: 'CLOSED_PERMANENTLY' }));
    assert.deepEqual(draft.warnings.map((warning) => warning.code), ['closed_permanently']);
    assert.match(draft.warnings[0]?.message ?? '', /permanently closed/);
    const paused = placeToDraft(listing({ businessStatus: 'CLOSED_TEMPORARILY' }));
    assert.deepEqual(paused.warnings.map((warning) => warning.code), ['closed_temporarily']);
  });

  it('moves an http website to https and says so, and leaves out one that is not public', () => {
    const upgraded = placeToDraft(listing({ websiteUri: 'http://harbor-roast.example.com/' }));
    assert.equal(upgraded.website, 'https://harbor-roast.example.com/');
    assert.deepEqual(upgraded.warnings.map((warning) => warning.code), ['website_upgraded']);
    assert.match(upgraded.warnings[0]?.message ?? '', /http:\/\/harbor-roast\.example\.com\/ without https/);
    const dropped = placeToDraft(listing({ websiteUri: 'http://192.168.0.4/' }));
    assert.equal(dropped.website, null);
    assert.deepEqual(dropped.warnings.map((warning) => warning.code), ['website_dropped']);
  });

  it('keeps the form’s own hours when Google has none, and says so', () => {
    const draft = placeToDraft(listing({ openingPeriods: [] }));
    assert.equal(draft.hours, null);
    assert.deepEqual(draft.warnings.map((warning) => warning.code), ['no_hours']);
  });

  it('leaves a field empty rather than filling it with something the form refuses', () => {
    const draft = placeToDraft(listing({
      phone: 'Ask at the counter',
      address: { street: 'x'.repeat(161), city: null, region: 'WA', postal: '98402', country: 'US' },
      location: null, timeZone: null,
    }));
    assert.equal(draft.phone, null);
    assert.equal(draft.street, null);
    assert.equal(draft.city, null);
    assert.equal(draft.lat, null);
    assert.equal(draft.lng, null);
    assert.equal(draft.timezone, null);
  });

  it('trims an overlong name to the form’s limit', () => {
    assert.equal(placeToDraft(listing({ name: 'A'.repeat(150) })).name.length, 120);
  });
});
