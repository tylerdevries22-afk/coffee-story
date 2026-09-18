export type Captured = { url: string; init: RequestInit | undefined };

/** Runs `body` with fetch stubbed, and hands back what the client actually sent. */
export async function withFetch(
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

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  });
}

export function sentHeaders(call: Captured | undefined): Headers {
  return new Headers(call?.init?.headers);
}

export function sentBody(call: Captured | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
}

/**
 * Answers a search with ids only and a Details lookup with `place`, the way
 * the two calls behind `findPlace` are answered by the real provider.
 */
export function searchThenDetails(place: { readonly id: string }) {
  return (call: Captured): Response => (call.url.includes('/places:searchText')
    ? json({ places: [{ id: place.id }] })
    : json(place));
}

/**
 * Shaped after the Places API (New) reference for the fields this package
 * masks. Not a recorded response: no key is used in tests.
 */
export const HOTEL = {
  id: 'ChIJExampleHotelIdentifier',
  displayName: { text: 'The Example Hotel', languageCode: 'en' },
  formattedAddress: '1 Example Street, Georgetown, CO 80444, USA',
  addressComponents: [
    { longText: '1', shortText: '1', types: ['street_number'] },
    { longText: 'Example Street', shortText: 'Example St', types: ['route'] },
    { longText: 'Georgetown', shortText: 'Georgetown', types: ['locality', 'political'] },
    { longText: 'Clear Creek County', shortText: 'Clear Creek County', types: ['administrative_area_level_2', 'political'] },
    { longText: 'Colorado', shortText: 'CO', types: ['administrative_area_level_1', 'political'] },
    { longText: 'United States', shortText: 'US', types: ['country', 'political'] },
    { longText: '80444', shortText: '80444', types: ['postal_code'] },
  ],
  location: { latitude: 39.7061, longitude: -105.6969 },
  timeZone: { id: 'America/Denver' },
  rating: 4.5,
  userRatingCount: 312,
  websiteUri: 'https://example.test/',
  internationalPhoneNumber: '+1 303-555-0100',
  regularOpeningHours: {
    openNow: true,
    // Open around the clock: one period, zero-valued open, no close. Proto3
    // JSON drops zero values, so the open time arrives as an empty object.
    periods: [{ open: {} }],
    weekdayDescriptions: ['Monday: Open 24 hours'],
  },
  photos: [{ name: 'places/abc/photos/def' }],
  types: ['hotel', 'lodging', 'point_of_interest', 'establishment'],
  primaryType: 'hotel',
  businessStatus: 'OPERATIONAL',
  googleMapsUri: 'https://maps.google.com/?cid=1',
  googleMapsLinks: {
    reviewsUri: 'https://www.google.com/maps/place//data=reviews',
    writeAReviewUri: 'https://www.google.com/maps/place//data=write-review',
  },
};
