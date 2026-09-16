/**
 * Google Places lookups for a property's own listing.
 *
 * Why this exists: a hotel tenant is a real building with a real listing, and
 * the platform should not ask an operator to retype what Google already knows.
 * One Place id resolves the name, address, coordinates, phone and opening
 * hours that a lobby screen and a location record both need.
 *
 * Two entry points, and the second is the one that makes "any hotel" true:
 * `placeDetails` reads a property whose Place id is already known, and
 * `findLodging` resolves a property from its name and address, so onboarding a
 * chain's next branch needs no id pasted in by hand and no edit to this repo.
 *
 * The key is read from the environment at the call site and never stored in a
 * tenant folder: every `EXPO_PUBLIC_*` value ships readable inside a guest
 * bundle, so a Places key belongs to server-side code only.
 */
import { ExternalRequestError, fetchExternalWithRetry } from './http';
import { PLACE_FIELDS, normalizePlace, isLodging, type PlaceDetails } from './places-types';

const ENDPOINT = 'https://places.googleapis.com/v1';

/** Bounds chosen for a screen a guest is standing in front of, not a batch job. */
const TRANSPORT = { timeoutMs: 6_000, attempts: 2, retryDelayMs: 300, maxResponseBytes: 262_144 } as const;

export class PlacesError extends Error {
  constructor(
    readonly code: 'unconfigured' | 'not_found' | 'not_lodging' | 'provider' | 'malformed',
    cause?: unknown,
  ) {
    super(
      code === 'unconfigured' ? 'No Google Places API key is configured.'
        : code === 'not_found' ? 'No such place.'
          : code === 'not_lodging' ? 'That place is not somewhere a guest stays.'
            : code === 'malformed' ? 'The Places response did not parse.'
              : 'The Places provider failed.',
      { cause },
    );
    this.name = 'PlacesError';
  }
}

export type PlacesOptions = {
  /** Server-side key. Omit and the caller gets `unconfigured`, never a guess. */
  readonly apiKey?: string | undefined;
  readonly signal?: AbortSignal | null;
};

function headers(apiKey: string, fields: readonly string[]): Record<string, string> {
  return {
    'content-type': 'application/json',
    // Places (New) bills by field mask, so an unset mask is both a cost and a
    // privacy question. Built from PLACE_FIELDS so it cannot drift from the type.
    'x-goog-fieldmask': fields.join(','),
    'x-goog-api-key': apiKey,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new PlacesError('malformed', error);
  }
}

async function call(
  path: string, init: RequestInit, apiKey: string, fields: readonly string[],
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchExternalWithRetry(`${ENDPOINT}${path}`, {
      ...init, headers: headers(apiKey, fields),
    }, TRANSPORT);
  } catch (error) {
    // Transport-level: timeout, network, or an exhausted retry. The key must
    // never reach a log line, so the cause is carried, not stringified here.
    throw new PlacesError('provider', error instanceof ExternalRequestError ? error : error);
  }
  if (response.status === 404) throw new PlacesError('not_found');
  if (!response.ok) throw new PlacesError('provider', response.status);
  return readJson(response);
}

function requireKey(options: PlacesOptions): string {
  const key = options.apiKey?.trim();
  if (!key) throw new PlacesError('unconfigured');
  return key;
}

/** The Place id shape the tenant parser and the `locations` column both accept. */
const PLACE_ID = /^[A-Za-z0-9_-]{6,255}$/;

/**
 * One property by Place id.
 *
 * `expectLodging` defaults on: a location declared as a hotel that resolves to
 * a restaurant is a data error worth failing, not rendering.
 */
export async function placeDetails(
  placeId: string,
  options: PlacesOptions,
  expectLodging = true,
): Promise<PlaceDetails> {
  const key = requireKey(options);
  if (!PLACE_ID.test(placeId)) throw new PlacesError('not_found');
  const body = await call(
    `/places/${encodeURIComponent(placeId)}`,
    { method: 'GET', signal: options.signal ?? null },
    key, PLACE_FIELDS,
  );
  const place = normalizePlace(body);
  if (!place) throw new PlacesError('malformed');
  if (expectLodging && !isLodging(place)) throw new PlacesError('not_lodging');
  return place;
}

/**
 * The lodging that best matches free text -- typically "<hotel name>, <city>".
 *
 * This is what lets a chain onboard its next branch without anyone pasting an
 * opaque id: the tenant folder names the property the way a person would, and
 * the id is resolved once and then stored.
 *
 * `includedType: 'lodging'` is sent so the provider filters rather than this
 * code sifting a page of cafés; the lodging check still runs on the result,
 * because a filter that silently stops being honoured should fail loudly.
 */
export async function findLodging(query: string, options: PlacesOptions): Promise<PlaceDetails> {
  const key = requireKey(options);
  const textQuery = query.trim();
  if (textQuery.length === 0) throw new PlacesError('not_found');
  const body = await call('/places:searchText', {
    method: 'POST',
    signal: options.signal ?? null,
    body: JSON.stringify({ textQuery, includedType: 'lodging', maxResultCount: 1 }),
  }, key, PLACE_FIELDS.map((field) => `places.${field}`));
  const places = (body as { places?: unknown })?.places;
  const first = Array.isArray(places) ? places[0] : undefined;
  if (first === undefined) throw new PlacesError('not_found');
  const place = normalizePlace(first);
  if (!place) throw new PlacesError('malformed');
  if (!isLodging(place)) throw new PlacesError('not_lodging');
  return place;
}

export { isLodging, type PlaceDetails, type PlaceCoordinates } from './places-types';
