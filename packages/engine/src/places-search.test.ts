import assert from 'node:assert/strict';
import test from 'node:test';

import { PlacesError, placeDetails } from './places';
import {
  PLACE_PREDICTION_MASK, autocompletePlaces, isPlacesSessionToken, newPlacesSessionToken, searchPlaceIds,
} from './places-search';
import { HOTEL, json, sentBody, sentHeaders, withFetch } from './places.test-support';

const isCode = (code: PlacesError['code']) => (error: unknown) =>
  error instanceof PlacesError && error.code === code;

const SUGGESTIONS = {
  suggestions: [
    {
      placePrediction: {
        place: 'places/ChIJExampleCafeIdentifier',
        placeId: 'ChIJExampleCafeIdentifier',
        text: { text: 'Example Cafe, Main Street, Georgetown, CO, USA' },
        structuredFormat: {
          mainText: { text: 'Example Cafe' },
          secondaryText: { text: 'Main Street, Georgetown, CO, USA' },
        },
        types: ['cafe', 'food', 'establishment'],
      },
    },
    // A query suggestion names no place, so it cannot be picked.
    { queryPrediction: { text: { text: 'cafes near Georgetown' } } },
    { placePrediction: { structuredFormat: { mainText: { text: 'No id' } } } },
  ],
};

// IDs-only Text Search is the one search Google does not bill. One extra field
// in this mask would bill every search in a 100-business batch.
test('searchPlaceIds asks for ids and nothing else', async () => {
  const calls = await withFetch(() => json({ places: [{ id: 'ChIJOne1' }, { id: 'ChIJTwo2' }] }), async () => {
    assert.deepEqual(await searchPlaceIds('Example Cafe', { apiKey: 'k' }, {}, 5), ['ChIJOne1', 'ChIJTwo2']);
  });
  assert.equal(sentHeaders(calls[0]).get('x-goog-fieldmask'), 'places.id');
  assert.equal(sentBody(calls[0]).pageSize, 5);
  assert.equal('includedType' in sentBody(calls[0]), false, 'an unset filter was sent anyway');
});

test('searchPlaceIds reads an empty result, which proto3 JSON sends as {}', async () => {
  await withFetch(() => json({}), async () => {
    assert.deepEqual(await searchPlaceIds('nowhere', { apiKey: 'k' }), []);
  });
});

test('searchPlaceIds keeps the page size inside what the provider accepts', async () => {
  const calls = await withFetch(() => json({}), async () => {
    for (const limit of [0, 99, Number.NaN, 2.7]) await searchPlaceIds('cafe', { apiKey: 'k' }, {}, limit);
  });
  assert.deepEqual(calls.map((call) => sentBody(call).pageSize), [1, 20, 1, 2]);
});

test('a malformed filter is refused before it becomes a metered request', async () => {
  const calls = await withFetch(() => json({}), async () => {
    await assert.rejects(searchPlaceIds('cafe', { apiKey: 'k' }, { includedType: 'Cafe; drop' }), isCode('not_found'));
    await assert.rejects(searchPlaceIds('cafe', { apiKey: 'k' }, { regionCode: 'usa' }), isCode('not_found'));
  });
  assert.equal(calls.length, 0);
});

test('autocompletePlaces sends the session and filters, and keeps only pickable places', async () => {
  const token = newPlacesSessionToken();
  const calls = await withFetch(() => json(SUGGESTIONS), async () => {
    const found = await autocompletePlaces('Example Ca', token, { apiKey: 'k' }, {
      includedType: 'cafe', regionCode: 'US',
    });
    assert.deepEqual(found, [{
      placeId: 'ChIJExampleCafeIdentifier',
      mainText: 'Example Cafe',
      secondaryText: 'Main Street, Georgetown, CO, USA',
      types: ['cafe', 'food', 'establishment'],
    }]);
  });
  const body = sentBody(calls[0]);
  assert.ok(calls[0]?.url.endsWith('/places:autocomplete'));
  assert.equal(body.sessionToken, token);
  assert.equal(body.input, 'Example Ca');
  assert.deepEqual(body.includedPrimaryTypes, ['cafe']);
  assert.deepEqual(body.includedRegionCodes, ['us']);
  assert.equal(sentHeaders(calls[0]).get('x-goog-fieldmask'), PLACE_PREDICTION_MASK.join(','));
});

// Without a session every keystroke bills on its own, so a caller that forgot
// the token is stopped rather than quietly charged.
test('autocompletePlaces will not run without a valid session token', async () => {
  const calls = await withFetch(() => json(SUGGESTIONS), async () => {
    for (const token of ['', 'x'.repeat(37), 'has spaces', 'slash/y']) {
      await assert.rejects(autocompletePlaces('Example', token, { apiKey: 'k' }), isCode('not_found'));
    }
  });
  assert.equal(calls.length, 0);
});

test('autocompletePlaces answers an emptied box without a request', async () => {
  const calls = await withFetch(() => json(SUGGESTIONS), async () => {
    assert.deepEqual(await autocompletePlaces('   ', newPlacesSessionToken(), { apiKey: 'k' }), []);
  });
  assert.equal(calls.length, 0);
});

// The session is only free if it ends in a Details call carrying the same token.
test('placeDetails closes the autocomplete session it is handed', async () => {
  const token = newPlacesSessionToken();
  const calls = await withFetch(() => json(HOTEL), async () => {
    await placeDetails(HOTEL.id, { apiKey: 'k' }, { sessionToken: token });
    await placeDetails(HOTEL.id, { apiKey: 'k' });
  });
  assert.equal(new URL(calls[0]?.url ?? '').searchParams.get('sessionToken'), token);
  assert.equal(new URL(calls[1]?.url ?? '').search, '', 'a lookup with no session invented one');
});

test('placeDetails refuses a malformed session token before any request', async () => {
  const calls = await withFetch(() => json(HOTEL), async () => {
    await assert.rejects(placeDetails(HOTEL.id, { apiKey: 'k' }, { sessionToken: 'a&b=c' }), isCode('not_found'));
  });
  assert.equal(calls.length, 0);
});

test('session tokens fit Google\'s format and are not reused', () => {
  const tokens = new Set(Array.from({ length: 50 }, () => newPlacesSessionToken()));
  assert.equal(tokens.size, 50);
  for (const token of tokens) assert.ok(isPlacesSessionToken(token), token);
  assert.equal(isPlacesSessionToken(42), false);
});

// A quota refusal clears by waiting; a batch must be able to tell it apart
// from a provider fault and pause instead of marking businesses failed.
test('an exhausted quota surfaces as over_quota after the transport retry', async () => {
  const calls = await withFetch(() => json({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429), async () => {
    await assert.rejects(searchPlaceIds('cafe', { apiKey: 'k' }), isCode('over_quota'));
  });
  assert.equal(calls.length, 2, 'the transport did not retry once before giving up');
});

test('every search entry point needs a key before it spends anything', async () => {
  const calls = await withFetch(() => json({}), async () => {
    await assert.rejects(searchPlaceIds('cafe', {}), isCode('unconfigured'));
    await assert.rejects(autocompletePlaces('cafe', newPlacesSessionToken(), { apiKey: ' ' }), isCode('unconfigured'));
  });
  assert.equal(calls.length, 0);
});
