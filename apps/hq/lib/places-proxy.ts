/**
 * The console's Google Places proxy: autocomplete while an admin types a
 * business name, then one Place Details call for the business they pick,
 * mapped straight into the wizard's draft.
 *
 * Two rules hold the cost to one billed call per business:
 *
 * - Autocomplete requires a session token, and Details requires the same one.
 *   Keystrokes in a session that ends in a Details call are not billed; a
 *   Details call without the token would leave every keystroke before it
 *   billed on its own. So this route refuses a Details lookup without one.
 * - Input is checked before anything is sent: a malformed request is answered
 *   here, never forwarded to be metered.
 *
 * US-first: suggestions are filtered to the US unless a region is named,
 * because the outreach this serves is geo-fenced there.
 *
 * Nothing Google or the key produced ever reaches a response body except the
 * mapped result: failures answer with fixed, user-safe messages.
 */
import {
  autocompletePlaces, isPlacesSessionToken, PLACE_QUERY_MAX, placeDetails, PlacesError,
  type PlacesErrorCode,
} from '@platform/engine';

import { log } from './log';
import { placeToDraft } from './place-to-draft';
import { placesError, placesJson, type PlacesContext, type PlacesRoute } from './places-proxy-context';

/** Matches the wizard, which does not ask before three characters. */
export const PLACE_QUERY_MIN = 3;
const BODY_MAX = 2_048;
const SUGGESTIONS_MAX = 5;
const PLACE_ID = /^[A-Za-z0-9_-]{6,255}$/;
const REGION = /^[a-z]{2}$/;

export type AutocompleteInput = { input: string; sessionToken: string; regionCode: string };
export type DetailsInput = { placeId: string; sessionToken: string };
type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const TOKEN_MESSAGE = 'The search session is not valid. Start the search again.';

export function autocompleteInput(body: Record<string, unknown>): Parsed<AutocompleteInput> {
  const { input, sessionToken, regionCode } = body;
  if (typeof input !== 'string' || input.length > PLACE_QUERY_MAX
    || input.trim().length < PLACE_QUERY_MIN) {
    return { ok: false, message: `Type between ${PLACE_QUERY_MIN} and ${PLACE_QUERY_MAX} characters.` };
  }
  if (!isPlacesSessionToken(sessionToken)) return { ok: false, message: TOKEN_MESSAGE };
  const region = regionCode === undefined ? 'us' : regionCode;
  if (typeof region !== 'string' || !REGION.test(region)) {
    return { ok: false, message: 'Name the region as a two-letter code.' };
  }
  return { ok: true, value: { input: input.trim(), sessionToken, regionCode: region } };
}

export function detailsInput(body: Record<string, unknown>): Parsed<DetailsInput> {
  const { placeId, sessionToken } = body;
  if (typeof placeId !== 'string' || !PLACE_ID.test(placeId)) {
    return { ok: false, message: 'That is not a Google place reference.' };
  }
  if (!isPlacesSessionToken(sessionToken)) return { ok: false, message: TOKEN_MESSAGE };
  return { ok: true, value: { placeId, sessionToken } };
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) {
    return placesError(415, 'invalid_request', 'Send the search as JSON.');
  }
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > BODY_MAX) {
    return placesError(413, 'invalid_request', 'That request is too large.');
  }
  const text = await request.text();
  if (text.length > BODY_MAX) return placesError(413, 'invalid_request', 'That request is too large.');
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Answered below, with the same message as a body that is not an object.
  }
  return placesError(400, 'invalid_request', 'The request body must be a JSON object.');
}

async function validBody<T>(
  request: Request, parse: (body: Record<string, unknown>) => Parsed<T>,
): Promise<T | Response> {
  const body = await jsonBody(request);
  if (body instanceof Response) return body;
  const parsed = parse(body);
  return parsed.ok ? parsed.value : placesError(400, 'invalid_request', parsed.message);
}

const RETRY = 'Try again, or enter the business details by hand.';
const FAILURES: Readonly<Record<PlacesErrorCode, readonly [number, string, string]>> = {
  unconfigured: [503, 'places_unconfigured', 'Google Places is not set up on this deployment. Enter the business details by hand.'],
  not_found: [404, 'place_not_found', 'Google no longer lists that place. Search again.'],
  not_lodging: [404, 'place_not_found', 'Google no longer lists that place. Search again.'],
  over_quota: [429, 'places_over_quota', `Google Places is over its quota for now. ${RETRY}`],
  provider: [502, 'places_unavailable', `Google Places did not answer. ${RETRY}`],
  malformed: [502, 'places_unavailable', `Google Places sent an answer this console cannot read. ${RETRY}`],
};

function failure(error: unknown, context: PlacesContext, route: PlacesRoute, request: Request): Response {
  if (!(error instanceof PlacesError)) {
    log.error(`places.${route}_failed`, { requestId: context.requestId }, error);
    return placesError(500, 'places_failed', `The lookup failed. ${RETRY}`);
  }
  // A lookup the browser abandoned -- the admin kept typing -- is not a failure.
  if (!request.signal.aborted) {
    log.warn(`places.${route}_failed`, { requestId: context.requestId, code: error.code });
  }
  const [status, code, message] = FAILURES[error.code];
  return placesError(status, code, message);
}

export async function placesAutocomplete(request: Request, context: PlacesContext): Promise<Response> {
  const input = await validBody(request, autocompleteInput);
  if (input instanceof Response) return input;
  try {
    const predictions = await autocompletePlaces(
      input.input, input.sessionToken,
      { apiKey: context.apiKey, signal: request.signal },
      { regionCode: input.regionCode },
    );
    return placesJson({
      predictions: predictions.slice(0, SUGGESTIONS_MAX)
        .map(({ placeId, mainText, secondaryText }) => ({ placeId, mainText, secondaryText })),
    });
  } catch (error) {
    return failure(error, context, 'autocomplete', request);
  }
}

export async function placesDetails(request: Request, context: PlacesContext): Promise<Response> {
  const input = await validBody(request, detailsInput);
  if (input instanceof Response) return input;
  try {
    const place = await placeDetails(
      input.placeId,
      { apiKey: context.apiKey, signal: request.signal },
      { sessionToken: input.sessionToken },
    );
    // One line per billed call, so the console's own log can be reconciled
    // against the Places bill without reading Google's.
    log.info('places.details_resolved', { requestId: context.requestId, actor: context.actor, placeId: place.placeId });
    return placesJson({ place: placeToDraft(place) });
  } catch (error) {
    return failure(error, context, 'details', request);
  }
}
