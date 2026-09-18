/**
 * Finding a place: the IDs-only text search a batch runs on, and the
 * autocomplete a person types into.
 *
 * Both answer with Place ids, never place data. The data comes from one Place
 * Details call on the id that was chosen, which is what holds a business to a
 * single billed lookup: IDs-only Text Search is not billed, and autocomplete
 * keystrokes are not billed when their session ends in that Details call.
 */
import { randomUUID } from 'node:crypto';

import { isRecord, strings, text } from './places-fields';
import { PlacesError, placesCall, requireKey, type PlacesOptions } from './places-transport';

/** Kept equal to tenant-config's bound, so no caller can meter an unbounded string. */
export const PLACE_QUERY_MAX = 200;

export type PlaceSearchFilters = {
  /** One Places type, e.g. `lodging` or `cafe`. */
  readonly includedType?: string;
  /** A two-letter CLDR region, e.g. `us`. */
  readonly regionCode?: string;
};

/** One autocomplete suggestion, shaped for a pick list. */
export type PlacePrediction = {
  readonly placeId: string;
  readonly mainText: string;
  /** Usually the address, drawn under the name. */
  readonly secondaryText: string | null;
  readonly types: readonly string[];
};

/**
 * Exactly the IDs-only SKU's field. Adding any other place field moves every
 * search in a batch onto a billed Text Search tier.
 */
export const PLACE_SEARCH_MASK: readonly string[] = ['places.id'];

export const PLACE_PREDICTION_MASK: readonly string[] = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat',
  'suggestions.placePrediction.types',
];

const PLACE_TYPE = /^[a-z][a-z0-9_]{1,63}$/;
const REGION = /^[a-z]{2}$/;
/** Google's rule: URL- and filename-safe base64, at most 36 characters. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{1,36}$/;

export function isPlacesSessionToken(value: unknown): value is string {
  return typeof value === 'string' && SESSION_TOKEN.test(value);
}

/** A v4 UUID is 36 URL-safe characters: exactly the budget Google allows. */
export function newPlacesSessionToken(): string {
  return randomUUID();
}

/**
 * Validated filters. A malformed one is refused rather than dropped, because
 * dropping it would turn a caller's bug into an unfiltered request that is
 * still metered, and "no such place" is the honest answer to a query that
 * cannot name one.
 */
function checked(filters: PlaceSearchFilters): { type: string | null; region: string | null } {
  const type = filters.includedType?.trim() || null;
  const region = filters.regionCode?.trim().toLowerCase() || null;
  if (type !== null && !PLACE_TYPE.test(type)) throw new PlacesError('not_found');
  if (region !== null && !REGION.test(region)) throw new PlacesError('not_found');
  return { type, region };
}

function boundedQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0 || query.length > PLACE_QUERY_MAX) throw new PlacesError('not_found');
  return trimmed;
}

/**
 * Place ids matching free text, best match first.
 *
 * `regionCode` here biases ranking and formatting; Text Search has no hard
 * region filter, so a caller that must stay in one country checks the
 * address that Place Details returns.
 */
export async function searchPlaceIds(
  query: string,
  options: PlacesOptions,
  filters: PlaceSearchFilters = {},
  limit = 1,
): Promise<readonly string[]> {
  const key = requireKey(options);
  const textQuery = boundedQuery(query);
  const { type, region } = checked(filters);
  const pageSize = Number.isFinite(limit) ? Math.min(20, Math.max(1, Math.trunc(limit))) : 1;
  const body = await placesCall('/places:searchText', {
    method: 'POST',
    signal: options.signal ?? null,
    body: JSON.stringify({
      textQuery, pageSize,
      ...(type === null ? {} : { includedType: type }),
      ...(region === null ? {} : { regionCode: region }),
    }),
  }, key, PLACE_SEARCH_MASK);
  const places = isRecord(body) && Array.isArray(body.places) ? body.places : [];
  return places
    .map((place) => (isRecord(place) ? text(place.id) : null))
    .filter((id): id is string => id !== null)
    .slice(0, pageSize);
}

function prediction(raw: unknown): PlacePrediction | null {
  const place = isRecord(raw) && isRecord(raw.placePrediction) ? raw.placePrediction : null;
  const placeId = place === null ? null : text(place.placeId);
  if (place === null || placeId === null) return null;
  const format: Record<string, unknown> = isRecord(place.structuredFormat) ? place.structuredFormat : {};
  const main = isRecord(format.mainText) ? text(format.mainText.text) : null;
  const secondary = isRecord(format.secondaryText) ? text(format.secondaryText.text) : null;
  return { placeId, mainText: main ?? placeId, secondaryText: secondary, types: strings(place.types) };
}

/**
 * Suggestions for what a person has typed so far.
 *
 * The session token is required, not optional: without one every keystroke
 * bills as its own request. The same token must then reach `placeDetails` for
 * the place the person picks, which is what closes the session unbilled.
 */
export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  options: PlacesOptions,
  filters: PlaceSearchFilters = {},
): Promise<readonly PlacePrediction[]> {
  const key = requireKey(options);
  if (!isPlacesSessionToken(sessionToken)) throw new PlacesError('not_found');
  // An empty box is someone who cleared the field, not a failed lookup.
  if (input.trim().length === 0) return [];
  const typed = boundedQuery(input);
  const { type, region } = checked(filters);
  const body = await placesCall('/places:autocomplete', {
    method: 'POST',
    signal: options.signal ?? null,
    body: JSON.stringify({
      input: typed, sessionToken,
      ...(type === null ? {} : { includedPrimaryTypes: [type] }),
      ...(region === null ? {} : { includedRegionCodes: [region] }),
    }),
  }, key, PLACE_PREDICTION_MASK);
  const suggestions = isRecord(body) && Array.isArray(body.suggestions) ? body.suggestions : [];
  return suggestions.flatMap((suggestion) => {
    const found = prediction(suggestion);
    return found === null ? [] : [found];
  });
}
