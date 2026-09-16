import assert from 'node:assert/strict';
import test from 'node:test';

import { PlacesError, findLodging, placeDetails } from './places';
import { isLodging, normalizePlace } from './places-types';

type Captured = { url: string; init: RequestInit | undefined };

/** Runs `body` with fetch stubbed, and hands back what the client actually sent. */
async function withFetch(
  responder: (call: Captured) => Response,
  body: (calls: Captured[]) => Promise<void>,
): Promise<Captured[]> {
  const originalFetch = globalThis.fetch;
  const calls: Captured[] = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  };
  try {
    await body(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return calls;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  });
}

const HOTEL = {
  id: 'ChIJExampleHotelIdentifier',
  displayName: { text: 'The Example Hotel' },
  formattedAddress: '1 Example Street, Georgetown, CO 80444, USA',
  location: { latitude: 39.7061, longitude: -105.6969 },
  rating: 4.5,
  userRatingCount: 312,
  websiteUri: 'https://example.test/',
  internationalPhoneNumber: '+1 303-555-0100',
  regularOpeningHours: { weekdayDescriptions: ['Monday: Open 24 hours'] },
  photos: [{ name: 'places/abc/photos/def' }],
  types: ['lodging', 'point_of_interest'],
};

/**
 * What a caller is entitled to assume about a lookup.
 *
 * The lookups themselves are Google's; what this module owns is the boundary --
 * that a key is required rather than guessed, that the response is validated
 * before it becomes a location record, and that a place which is not a hotel
 * cannot quietly become one.
 */
test('placeDetails returns a normalized property', async () => {
  const calls = await withFetch(() => json(HOTEL), async () => {
    const place = await placeDetails('ChIJExampleHotelIdentifier', { apiKey: 'k' });
    assert.equal(place.name, 'The Example Hotel');
    assert.deepEqual(place.location, { lat: 39.7061, lng: -105.6969 });
    assert.equal(place.phone, '+1 303-555-0100');
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
  const sent = new Headers(calls[0]?.init?.headers);
  const mask = sent.get('x-goog-fieldmask') ?? '';
  assert.ok(mask.includes('displayName') && mask.includes('id'));
  assert.equal(mask.includes('reviews'), false, 'the mask reached review bodies');
  assert.equal(sent.get('x-goog-api-key'), 'secret-key');
  assert.equal(calls[0]?.url.includes('secret-key'), false, 'the key was put in the URL');
});

// The whole point of storing a Place id on a hotel location: if it resolves to
// the cafe next door, the lobby screen would show a cafe's hours under the
// hotel's name and nothing downstream would notice.
test('placeDetails refuses a place that is not somewhere a guest stays', async () => {
  await withFetch(() => json({ ...HOTEL, types: ['cafe'] }), async () => {
    await assert.rejects(
      placeDetails('ChIJExampleHotelIdentifier', { apiKey: 'k' }),
      (error: unknown) => error instanceof PlacesError && error.code === 'not_lodging',
    );
  });
});

test('placeDetails will not call the provider without a key', async () => {
  const calls = await withFetch(() => json(HOTEL), async () => {
    await assert.rejects(
      placeDetails('ChIJExampleHotelIdentifier', {}),
      (error: unknown) => error instanceof PlacesError && error.code === 'unconfigured',
    );
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
test('findLodging resolves a property from free text', async () => {
  const calls = await withFetch(() => json({ places: [HOTEL] }), async () => {
    const place = await findLodging('The Example Hotel, Georgetown CO', { apiKey: 'k' });
    assert.equal(place.placeId, 'ChIJExampleHotelIdentifier');
  });
  const body = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(body.includedType, 'lodging', 'the provider was not asked to filter');
  assert.equal(body.textQuery, 'The Example Hotel, Georgetown CO');
});

test('findLodging reports no match rather than inventing one', async () => {
  await withFetch(() => json({ places: [] }), async () => {
    await assert.rejects(
      findLodging('nowhere at all', { apiKey: 'k' }),
      (error: unknown) => error instanceof PlacesError && error.code === 'not_found',
    );
  });
});

test('findLodging rejects an oversized query before spending a provider call', async () => {
  const calls = await withFetch(() => json({ places: [HOTEL] }), async () => {
    await assert.rejects(
      findLodging('x'.repeat(201), { apiKey: 'k' }),
      (error: unknown) => error instanceof PlacesError && error.code === 'not_found',
    );
  });
  assert.equal(calls.length, 0);
});

test('a provider failure surfaces as provider, not as a malformed place', async () => {
  await withFetch(() => new Response('nope', { status: 403 }), async () => {
    await assert.rejects(
      placeDetails('ChIJExampleHotelIdentifier', { apiKey: 'k' }),
      (error: unknown) => error instanceof PlacesError && error.code === 'provider',
    );
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
  assert.equal(place?.formattedAddress, null);
  assert.equal(place?.location, null);
  assert.equal(place?.rating, null);
  assert.deepEqual(place?.weekdayDescriptions, []);
  assert.equal(place?.name, 'ChIJbare', 'a nameless place lost its handle');
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
