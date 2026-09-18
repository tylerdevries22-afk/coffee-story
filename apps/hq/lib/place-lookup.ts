/**
 * The wizard's side of the Places proxy: one same-origin POST, and an answer
 * the search box can act on.
 *
 * Failures come back as values, sorted into the one distinction the wizard
 * acts on: Places is not set up here at all (a 503 -- open the manual fields
 * and stop asking), or it failed this once (say so, and let typing retry). An
 * abandoned lookup -- the admin kept typing -- rejects, so the caller can
 * tell it apart from either and ignore it.
 *
 * Browser-safe on purpose: it imports no engine code, only types, so the key
 * and the Places client stay out of the bundle.
 */
import type { PlaceDraft } from './place-to-draft';
import type { LookupFailure, PlaceSuggestion } from './place-search-session';

export type Lookup<T> = { readonly ok: true; readonly value: T } | ({ readonly ok: false } & LookupFailure);

const OFFLINE = 'The console could not reach Google Places. Try again, or enter the details by hand.';
const UNREADABLE = 'Google Places sent an answer the console cannot read. Enter the details by hand.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(body: unknown): string | null {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  return error && typeof error.message === 'string' ? error.message : null;
}

async function post(path: 'autocomplete' | 'details', body: unknown, signal: AbortSignal): Promise<Lookup<unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/places/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal, credentials: 'same-origin', cache: 'no-store',
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, reason: 'error', message: OFFLINE };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // A body that is not JSON is answered by the status alone.
  }
  if (response.ok) return { ok: true, value: json };
  return {
    ok: false, reason: response.status === 503 ? 'unavailable' : 'error',
    message: errorMessage(json) ?? OFFLINE,
  };
}

function suggestionOf(value: unknown): PlaceSuggestion | null {
  if (!isRecord(value) || typeof value.placeId !== 'string' || typeof value.mainText !== 'string') return null;
  const secondary = typeof value.secondaryText === 'string' ? value.secondaryText : null;
  return { placeId: value.placeId, mainText: value.mainText, secondaryText: secondary };
}

export async function suggestPlaces(
  input: string, sessionToken: string, signal: AbortSignal,
): Promise<Lookup<readonly PlaceSuggestion[]>> {
  const answer = await post('autocomplete', { input, sessionToken }, signal);
  if (!answer.ok) return answer;
  const listed = isRecord(answer.value) && Array.isArray(answer.value.predictions) ? answer.value.predictions : null;
  if (listed === null) return { ok: false, reason: 'error', message: UNREADABLE };
  return {
    ok: true,
    value: listed.map(suggestionOf).filter((entry): entry is PlaceSuggestion => entry !== null),
  };
}

/** The draft for a picked suggestion, closing the search session it was found in. */
export async function resolvePlace(
  placeId: string, sessionToken: string, signal: AbortSignal,
): Promise<Lookup<PlaceDraft>> {
  const answer = await post('details', { placeId, sessionToken }, signal);
  if (!answer.ok) return answer;
  const place = isRecord(answer.value) ? answer.value.place : null;
  const readable = isRecord(place) && typeof place.googlePlaceId === 'string' && typeof place.name === 'string'
    && isRecord(place.industry) && Array.isArray(place.warnings);
  // The proxy is this deployment's own; checking the fields the wizard
  // branches on is enough to keep a bad deploy from crashing the form.
  return readable ? { ok: true, value: place as PlaceDraft } : { ok: false, reason: 'error', message: UNREADABLE };
}
