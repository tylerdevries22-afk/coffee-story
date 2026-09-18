import assert from 'node:assert/strict';
import test from 'node:test';

import { PlacesError, findLodging, findPlace, lodgingDetails, placeDetails } from './places';
import { HOTEL, json, searchThenDetails, sentBody, sentHeaders, withFetch } from './places.test-support';
import { isLodging, normalizePlace } from './places-types';

const CAFE = { ...HOTEL, id: 'ChIJExampleCafeIdentifier', types: ['cafe', 'food'], primaryType: 'cafe' };

const isCode = (code: PlacesError['code']) => (error: unknown) =>
  error instanceof PlacesError && error.code === code;

/**
 * What a caller is entitled to assume about a lookup.
 *
 * The lookups themselves are Google's; what this module owns is the boundary --
 * that a key is required rather than guessed, that the response is validated
 * before it becomes a location record, that each business costs one billed
 * call, and that a place which is not a hotel cannot quietly become one.
 */
test('placeDetails returns a normalized place', async () => {
  const calls = await withFetch(() => json(HOTEL), async () => {
    const place = await placeDetails('ChIJExampleHotelIdentifier', { apiKey: 'k' });
    assert.equal(place.name, 'The Example Hotel');
    assert.deepEqual(place.location, { lat: 39.7061, lng: -105.6969 });
    assert.equal(place.phone, '+1 303-555-0100');
    assert.equal(place.timeZone, 'America/Denver');
    assert.deepEqual(place.weekdayDescriptions, ['Monday: Open 24 hours']);
  });
  assert.equal(calls.length, 1);
});

// Places (New) bills by field mask and returns everything if one is not sent.
// An unset mask is therefore both a cost and a privacy question, so it is
// asserted rather than assumed.
test('placeDetails sends a bounded field mask and the key as a header', async () => {
  const calls = await withFetch(() => json(HOTEL), async () => {
    await placeDetails('ChIJExampleHotelIdentifier', { apiKey: 'secret-key' });
  });
  const sent = sentHeaders(calls[0]);
  const mask = (sent.get('x-goog-fieldmask') ?? '').split(',');
  assert.ok(mask.includes('displayName') && mask.includes('id'));
  assert.equal(mask.some((field) => field === 'reviews' || field.startsWith('reviews.')), false,
    'the mask reached review bodies');
  assert.equal(sent.get('x-goog-api-key'), 'secret-key');
  assert.equal(calls[0]?.url.includes('secret-key'), false, 'the key was put in the URL');
});

// The generic lookup serves every industry; only the hotel entry points refuse.
test('placeDetails accepts a business that is not lodging', async () => {
  await withFetch(() => json(CAFE), async () => {
    const place = await placeDetails(CAFE.id, { apiKey: 'k' });
    assert.equal(place.primaryType, 'cafe');
  });
});

// The whole point of storing a Place id on a hotel location: if it resolves to
// the cafe next door, the lobby screen would show a cafe's hours under the
// hotel's name and nothing downstream would notice.
test('lodgingDetails refuses a place that is not somewhere a guest stays', async () => {
  await withFetch(() => json(CAFE), async () => {
    await assert.rejects(lodgingDetails(CAFE.id, { apiKey: 'k' }), isCode('not_lodging'));
  });
});

test('placeDetails will not call the provider without a key', async () => {
  const calls = await withFetch(() => json(HOTEL), async () => {
    await assert.rejects(placeDetails('ChIJExampleHotelIdentifier', {}), isCode('unconfigured'));
  });
  assert.equal(calls.length, 0, 'an unkeyed lookup still reached the network');
});

test('placeDetails rejects an id that is not a Place id before any request', async () => {
  const calls = await withFetch(() => json(HOTEL), async () => {
    await assert.rejects(placeDetails('../../etc/passwd', { apiKey: 'k' }));
  });
  assert.equal(calls.length, 0);
});

// This is what makes "any hotel chain or location" true rather than aspirational:
// a branch is named the way a person would name it and resolved once.
test('findLodging resolves a property from free text in one billed call', async () => {
  const calls = await withFetch(searchThenDetails(HOTEL), async () => {
    const place = await findLodging('The Example Hotel, Georgetown CO', { apiKey: 'k' });
    assert.equal(place.placeId, 'ChIJExampleHotelIdentifier');
  });
  assert.equal(calls.length, 2);
  const search = sentBody(calls[0]);
  assert.equal(search.includedType, 'lodging', 'the provider was not asked to filter');
  assert.equal(search.textQuery, 'The Example Hotel, Georgetown CO');
  // The search must stay on the IDs-only SKU; the Details call is the one that bills.
  assert.equal(sentHeaders(calls[0]).get('x-goog-fieldmask'), 'places.id');
  assert.ok(calls[1]?.url.endsWith('/places/ChIJExampleHotelIdentifier'));
  assert.equal(calls[1]?.init?.method, 'GET');
});

test('findLodging refuses a winner that is not lodging', async () => {
  await withFetch(searchThenDetails(CAFE), async () => {
    await assert.rejects(findLodging('Example Cafe, Georgetown CO', { apiKey: 'k' }), isCode('not_lodging'));
  });
});

test('findPlace resolves any business and passes its filters to the search', async () => {
  const calls = await withFetch(searchThenDetails(CAFE), async () => {
    const place = await findPlace('Example Cafe', { apiKey: 'k' }, { includedType: 'cafe', regionCode: 'US' });
    assert.equal(place.placeId, CAFE.id);
  });
  assert.equal(sentBody(calls[0]).includedType, 'cafe');
  assert.equal(sentBody(calls[0]).regionCode, 'us');
});

test('findLodging reports no match rather than inventing one', async () => {
  const calls = await withFetch(() => json({}), async () => {
    await assert.rejects(findLodging('nowhere at all', { apiKey: 'k' }), isCode('not_found'));
  });
  assert.equal(calls.length, 1, 'a search with no match still paid for a Details call');
});

test('findLodging rejects an oversized query before spending a provider call', async () => {
  const calls = await withFetch(() => json({ places: [HOTEL] }), async () => {
    await assert.rejects(findLodging('x'.repeat(201), { apiKey: 'k' }), isCode('not_found'));
  });
  assert.equal(calls.length, 0);
});

test('a provider failure surfaces as provider, not as a malformed place', async () => {
  await withFetch(() => new Response('nope', { status: 403 }), async () => {
    await assert.rejects(placeDetails('ChIJExampleHotelIdentifier', { apiKey: 'k' }), isCode('provider'));
  });
});

/**
 * Normalization is total: every field but the id is optional in the response,
 * and a hotel with no published phone number is an ordinary hotel rather than a
 * failed lookup.
 */
test('normalizePlace fills what is missing with null rather than throwing', () => {
  const place = normalizePlace({ id: 'ChIJbare', types: ['lodging'] });
  assert.ok(place);
  assert.equal(place.formattedAddress, null);
  assert.equal(place.location, null);
  assert.equal(place.rating, null);
  assert.equal(place.timeZone, null);
  assert.deepEqual(place.weekdayDescriptions, []);
  assert.deepEqual(place.openingPeriods, []);
  assert.deepEqual(place.address, { street: null, city: null, region: null, postal: null, country: null });
  assert.equal(place.name, 'ChIJbare', 'a nameless place lost its handle');
});

test('normalizePlace rejects a place with no id, which nothing could be stored against', () => {
  assert.equal(normalizePlace({ displayName: { text: 'Anonymous' } }), null);
  assert.equal(normalizePlace(null), null);
  assert.equal(normalizePlace('a place'), null);
});

// A half-read coordinate would put a Colorado hotel on the prime meridian,
// which is worse than admitting the position is unknown.
test('normalizePlace drops a partial or out-of-range coordinate', () => {
  assert.equal(normalizePlace({ id: 'a', location: { latitude: 39.7 } })?.location, null);
  assert.equal(normalizePlace({ id: 'a', location: { latitude: 91, longitude: 0 } })?.location, null);
  assert.equal(normalizePlace({ id: 'a', location: { latitude: 0, longitude: 0 } })?.location?.lat, 0,
    'a genuine null island reading was discarded as if it were missing');
});

test('isLodging spans the type names Google actually uses for a stay', () => {
  for (const type of ['lodging', 'hotel', 'resort_hotel', 'bed_and_breakfast', 'hostel']) {
    assert.ok(isLodging({ types: [type] }), `${type} was not treated as lodging`);
  }
  assert.equal(isLodging({ types: ['restaurant', 'bar'] }), false);
  assert.equal(isLodging({ types: [] }), false);
});
