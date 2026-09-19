/**
 * The proxy's contract, end to end against a stubbed Google: who may call it,
 * how often, what it refuses before spending anything, how a failure reads,
 * and that the key never comes back out.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { POST as autocompleteRoute } from '../app/api/places/autocomplete/route';
import { POST as detailsRoute } from '../app/api/places/details/route';
import type { SessionInfo } from './demo-data';
import { placesAutocomplete, placesDetails } from './places-proxy';
import { PLACES_LIMITS, placesKey, placesRequestContext, type PlacesDeps, type PlacesRoute } from './places-proxy-context';
import { resetRateLimits } from './rate-limit';

const KEY = 'test-only-places-key-4f1c9a';
const TOKEN = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const HQ = 'https://hq.example.test';

const ADMIN: SessionInfo = {
  userId: 'admin-1', email: 'admin@example.test', role: 'platform_admin', brandId: 'b-1', brandName: 'Platform',
};

type Upstream = { url: string; init: RequestInit | undefined };
let upstream: Upstream[] = [];
let answer: (sent: Upstream) => Response = () => Response.json({});
const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetRateLimits();
  upstream = [];
  globalThis.fetch = async (input, init) => {
    const sent = { url: String(input), init };
    upstream.push(sent);
    return answer(sent);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** `key: null` is an unset key; a default parameter would swallow `undefined`. */
function deps(session: SessionInfo | null = ADMIN, key: string | null = KEY): PlacesDeps & { lookups: () => number } {
  let lookups = 0;
  return {
    session: async () => { lookups += 1; return session; },
    apiKey: () => key ?? undefined,
    lookups: () => lookups,
  };
}

function request(route: PlacesRoute, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${HQ}/api/places/${route}`, {
    method: 'POST',
    headers: {
      origin: HQ, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
      'x-real-ip': '203.0.113.7', ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** What each route file does, with the session and key injected. */
async function call(route: PlacesRoute, req: Request, with_: PlacesDeps = deps()): Promise<Response> {
  const context = await placesRequestContext(req, route, with_);
  if (context instanceof Response) return context;
  return route === 'autocomplete' ? placesAutocomplete(req, context) : placesDetails(req, context);
}

const SEARCH = { input: 'harbor roast', sessionToken: TOKEN };
const PICK = { placeId: 'ChIJHarborRoastExample01', sessionToken: TOKEN };

const SUGGESTIONS = {
  suggestions: [{
    placePrediction: {
      placeId: 'ChIJHarborRoastExample01',
      structuredFormat: { mainText: { text: 'Harbor Roast' }, secondaryText: { text: 'Pier St, Tacoma, WA, USA' } },
      types: ['coffee_shop', 'cafe', 'establishment'],
    },
  }],
};

const PLACE = {
  id: 'ChIJHarborRoastExample01',
  displayName: { text: 'Harbor Roast' },
  addressComponents: [
    { longText: '12', shortText: '12', types: ['street_number'] },
    { longText: 'Pier Street', shortText: 'Pier St', types: ['route'] },
    { longText: 'Tacoma', shortText: 'Tacoma', types: ['locality'] },
    { longText: 'Washington', shortText: 'WA', types: ['administrative_area_level_1'] },
    { longText: '98402', shortText: '98402', types: ['postal_code'] },
    { longText: 'United States', shortText: 'US', types: ['country'] },
  ],
  location: { latitude: 47.2529, longitude: -122.4443 },
  timeZone: { id: 'America/Los_Angeles' },
  websiteUri: 'http://harbor-roast.example.com/',
  internationalPhoneNumber: '+1 253-555-0142',
  regularOpeningHours: {
    periods: [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 1, minute: 0 } }],
  },
  types: ['coffee_shop', 'cafe', 'food', 'establishment'],
  primaryType: 'coffee_shop',
  businessStatus: 'OPERATIONAL',
  photos: [{ name: 'places/ChIJHarborRoastExample01/photos/p1' }],
  rating: 4.6,
};

/** Everything a caller could read: the headers and the body, as text. */
async function readable(response: Response): Promise<{ headers: string; body: string }> {
  return { headers: JSON.stringify([...response.headers]), body: await response.text() };
}

describe('autocomplete', () => {
  it('asks Google with the server key, US-first, and answers only the pick list', async () => {
    answer = () => Response.json(SUGGESTIONS);
    const response = await call('autocomplete', request('autocomplete', SEARCH));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.deepEqual(await response.json(), { predictions: [{
      placeId: 'ChIJHarborRoastExample01', mainText: 'Harbor Roast', secondaryText: 'Pier St, Tacoma, WA, USA',
    }] });
    assert.equal(upstream.length, 1);
    assert.match(upstream[0]?.url ?? '', /\/places:autocomplete$/);
    assert.equal(new Headers(upstream[0]?.init?.headers).get('x-goog-api-key'), KEY);
    assert.deepEqual(JSON.parse(String(upstream[0]?.init?.body)), {
      input: 'harbor roast', sessionToken: TOKEN, includedRegionCodes: ['us'],
    });
  });

  it('refuses before spending anything: origin, sign-in, role, and malformed input', async () => {
    const owner: SessionInfo = { ...ADMIN, userId: 'owner-1', role: 'brand_owner' };
    const refusals: readonly [Request, PlacesDeps, number][] = [
      [request('autocomplete', SEARCH, { origin: 'https://attacker.example' }), deps(), 403],
      [request('autocomplete', SEARCH, { 'sec-fetch-site': 'cross-site' }), deps(), 403],
      [request('autocomplete', SEARCH), deps(null), 401],
      [request('autocomplete', SEARCH), deps(owner), 403],
      [request('autocomplete', { ...SEARCH, input: 'ha' }), deps(), 400],
      [request('autocomplete', { ...SEARCH, input: 'h'.repeat(201) }), deps(), 400],
      [request('autocomplete', { ...SEARCH, sessionToken: 'not a token!' }), deps(), 400],
      [request('autocomplete', { input: 'harbor roast' }), deps(), 400],
      [request('autocomplete', { ...SEARCH, regionCode: 'USA' }), deps(), 400],
      [request('autocomplete', '{"input":'), deps(), 400],
      [request('autocomplete', '[1,2]'), deps(), 400],
      [request('autocomplete', SEARCH, { 'content-type': 'text/plain' }), deps(), 415],
      [request('autocomplete', { ...SEARCH, padding: 'x'.repeat(3_000) }), deps(), 413],
    ];
    for (const [req, with_, status] of refusals) {
      const response = await call('autocomplete', req, with_);
      assert.equal(response.status, status, `${status} expected`);
      const body = await response.json() as { error?: { code?: string; message?: string } };
      assert.equal(typeof body.error?.code, 'string');
      assert.equal(typeof body.error?.message, 'string');
    }
    assert.equal(upstream.length, 0, 'nothing reached Google');
  });

  it('answers 503 when the key is not set, and only to an admin', async () => {
    const unconfigured = await call('autocomplete', request('autocomplete', SEARCH), deps(ADMIN, null));
    assert.equal(unconfigured.status, 503);
    assert.equal((await unconfigured.json() as { error: { code: string } }).error.code, 'places_unconfigured');
    const stranger = await call('autocomplete', request('autocomplete', SEARCH), deps(null, null));
    assert.equal(stranger.status, 401);
    assert.equal(upstream.length, 0);
  });

  it('throttles an address before it costs a session lookup', async () => {
    answer = () => Response.json(SUGGESTIONS);
    const with_ = deps();
    for (let index = 0; index < PLACES_LIMITS.autocomplete.perAddress; index += 1) {
      await call('autocomplete', request('autocomplete', SEARCH, { 'x-real-ip': '198.51.100.9' }), deps());
    }
    const throttled = await call('autocomplete', request('autocomplete', SEARCH, { 'x-real-ip': '198.51.100.9' }), with_);
    assert.equal(throttled.status, 429);
    assert.equal(with_.lookups(), 0);
  });

  it('throttles one admin across addresses', async () => {
    answer = () => Response.json(SUGGESTIONS);
    const limit = PLACES_LIMITS.autocomplete.perAdmin;
    for (let index = 0; index < limit; index += 1) {
      const response = await call('autocomplete', request('autocomplete', SEARCH, { 'x-real-ip': `192.0.2.${index}` }));
      assert.equal(response.status, 200);
    }
    const throttled = await call('autocomplete', request('autocomplete', SEARCH, { 'x-real-ip': '192.0.2.250' }));
    assert.equal(throttled.status, 429);
    assert.equal(upstream.length, limit);
  });
});

describe('details', () => {
  it('closes the search session and answers the wizard draft', async () => {
    answer = () => Response.json(PLACE);
    const response = await call('details', request('details', PICK));
    assert.equal(response.status, 200);
    assert.equal(upstream.length, 1);
    const sent = new URL(upstream[0]?.url ?? '');
    assert.equal(sent.pathname, '/v1/places/ChIJHarborRoastExample01');
    assert.equal(sent.searchParams.get('sessionToken'), TOKEN);
    const { place } = await response.json() as { place: Record<string, unknown> };
    assert.equal(place.name, 'Harbor Roast');
    assert.equal(place.street, '12 Pier Street');
    assert.equal(place.website, 'https://harbor-roast.example.com/');
    assert.deepEqual(place.hours, { fri: [{ open: '18:00', close: '01:00' }] });
    assert.deepEqual(place.industry, { key: 'coffee-shop', confidence: 'high', reason: 'Google lists it as “coffee shop”.' });
    assert.equal('photoNames' in place || 'rating' in place, false);
  });

  it('refuses a lookup without the session its suggestions came from, or a malformed id', async () => {
    for (const body of [{ placeId: PICK.placeId }, { ...PICK, placeId: '../../v1/admin' }, { ...PICK, placeId: 'abc' }]) {
      assert.equal((await call('details', request('details', body))).status, 400, JSON.stringify(body));
    }
    assert.equal(upstream.length, 0);
  });

  it('holds a tighter budget than autocomplete, because it is the call that bills', async () => {
    answer = () => Response.json(PLACE);
    assert.ok(PLACES_LIMITS.details.perAdmin < PLACES_LIMITS.autocomplete.perAdmin);
    for (let index = 0; index < PLACES_LIMITS.details.perAdmin; index += 1) {
      await call('details', request('details', PICK, { 'x-real-ip': `192.0.2.${index}` }));
    }
    assert.equal((await call('details', request('details', PICK, { 'x-real-ip': '192.0.2.251' }))).status, 429);
  });
});

describe('failures', () => {
  const cases: readonly [string, () => Response, number, string][] = [
    ['quota', () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }), 429, 'places_over_quota'],
    ['outage', () => new Response('upstream said no', { status: 500 }), 502, 'places_unavailable'],
    ['unknown place', () => new Response('{}', { status: 404 }), 404, 'place_not_found'],
    ['garbled answer', () => new Response('<html>', { status: 200 }), 502, 'places_unavailable'],
    ['refused key', () => new Response(`{"error":{"message":"API key ${KEY} not valid"}}`, { status: 400 }), 502, 'places_unavailable'],
  ];
  for (const [name, respond, status, code] of cases) {
    it(`maps a ${name} to ${status} without echoing Google or the key`, async () => {
      answer = respond;
      for (const route of ['autocomplete', 'details'] as const) {
        resetRateLimits();
        const response = await call(route, request(route, route === 'details' ? PICK : SEARCH));
        assert.equal(response.status, status, route);
        const { headers, body } = await readable(response);
        assert.equal(`${headers}${body}`.includes(KEY), false, `${route} leaked the key`);
        assert.equal(body.includes('upstream said no') || body.includes('RESOURCE_EXHAUSTED'), false);
        assert.equal((JSON.parse(body) as { error: { code: string } }).error.code, code);
      }
    });
  }
});

describe('the route files', () => {
  it('put every request through the gate before anything else', async () => {
    const previous = process.env.GOOGLE_PLACES_API_KEY;
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    try {
      const routes = [['autocomplete', autocompleteRoute], ['details', detailsRoute]] as const;
      for (const [route, post] of routes) {
        const body = route === 'details' ? PICK : SEARCH;
        const response = await post(request(route, body, { origin: 'https://attacker.example' }));
        assert.equal(response.status, 403, route);
        assert.equal((await readable(response)).body.includes(KEY), false);
      }
      assert.equal(upstream.length, 0);
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = previous;
    }
  });
});

describe('the key', () => {
  it('is read from the environment on each request, and blank means unset', () => {
    assert.equal(placesKey({ GOOGLE_PLACES_API_KEY: ` ${KEY} ` }), KEY);
    assert.equal(placesKey({ GOOGLE_PLACES_API_KEY: '  ' }), undefined);
    assert.equal(placesKey({}), undefined);
  });
});
