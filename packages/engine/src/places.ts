/**
 * Google Places lookups for a business's own listing.
 *
 * Why this exists: a tenant is a real business with a real listing, and the
 * platform should not ask anyone to retype what Google already knows. One
 * Place id resolves the name, address, coordinates, phone, hours, time zone
 * and review links that a location record, a lobby screen and a demo all need.
 *
 * Every entry point ends in exactly one Place Details call, because that is
 * the call that bills. `placeDetails` reads a known id, and closes an
 * autocomplete session when handed its token; `findPlace` resolves free text
 * through the unbilled IDs-only search first, so a chain's next branch needs
 * no id pasted in by hand. `lodgingDetails` and `findLodging` are the same two
 * lookups for a caller that has declared the place a hotel, and they fail
 * rather than onboard the café next door.
 *
 * The key is read from the environment at the call site and never stored in a
 * tenant folder: every `EXPO_PUBLIC_*` value ships readable inside a guest
 * bundle, so a Places key belongs to server-side code only.
 */
import { isPlacesSessionToken, searchPlaceIds, type PlaceSearchFilters } from './places-search';
import { PlacesError, placesCall, requireKey, type PlacesOptions } from './places-transport';
import { PLACE_FIELDS, isLodging, normalizePlace, type PlaceDetails } from './places-types';

export { PlacesError, type PlacesErrorCode, type PlacesOptions } from './places-transport';

/** The Place id shape the tenant parser and the `locations` column both accept. */
const PLACE_ID = /^[A-Za-z0-9_-]{6,255}$/;

export type PlaceDetailsRequest = {
  /**
   * The autocomplete session this lookup ends. Passing it is what leaves the
   * keystrokes before it unbilled; without it they bill as separate requests.
   */
  readonly sessionToken?: string;
};

/** One place by Place id, whatever kind of business it is. */
export async function placeDetails(
  placeId: string,
  options: PlacesOptions,
  request: PlaceDetailsRequest = {},
): Promise<PlaceDetails> {
  const key = requireKey(options);
  if (!PLACE_ID.test(placeId)) throw new PlacesError('not_found');
  const { sessionToken } = request;
  if (sessionToken !== undefined && !isPlacesSessionToken(sessionToken)) {
    throw new PlacesError('not_found');
  }
  const session = sessionToken === undefined ? '' : `?sessionToken=${encodeURIComponent(sessionToken)}`;
  const body = await placesCall(
    `/places/${encodeURIComponent(placeId)}${session}`,
    { method: 'GET', signal: options.signal ?? null },
    key, PLACE_FIELDS,
  );
  const place = normalizePlace(body);
  if (!place) throw new PlacesError('malformed');
  return place;
}

/**
 * The best match for free text -- typically "<business name>, <city>".
 *
 * Two calls, on purpose: the search asks for ids only, which is not billed,
 * and the one billed call is the Details lookup on the winner. A search that
 * asked for the full field set would bill at a Text Search tier that costs
 * more than the Details call it replaces.
 */
export async function findPlace(
  query: string,
  options: PlacesOptions,
  filters: PlaceSearchFilters = {},
): Promise<PlaceDetails> {
  const [placeId] = await searchPlaceIds(query, options, filters, 1);
  if (placeId === undefined) throw new PlacesError('not_found');
  return placeDetails(placeId, options);
}

function lodgingOnly(place: PlaceDetails): PlaceDetails {
  if (!isLodging(place)) throw new PlacesError('not_lodging');
  return place;
}

/**
 * One property by Place id, refused unless it is somewhere a guest stays: a
 * location declared as a hotel that resolves to a restaurant is a data error
 * worth failing, not rendering.
 */
export async function lodgingDetails(placeId: string, options: PlacesOptions): Promise<PlaceDetails> {
  return lodgingOnly(await placeDetails(placeId, options));
}

/**
 * The lodging that best matches free text.
 *
 * `includedType: 'lodging'` is sent so the provider ranks hotels first rather
 * than this code sifting a page of cafés; the lodging check still runs on the
 * result, because a filter that silently stops being honoured should fail
 * loudly.
 */
export async function findLodging(query: string, options: PlacesOptions): Promise<PlaceDetails> {
  return lodgingOnly(await findPlace(query, options, { includedType: 'lodging' }));
}
