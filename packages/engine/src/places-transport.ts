/**
 * The one way this package talks to Places API (New): a bounded request, a
 * field mask on every call, the key in a header, and one error type whose
 * code says what the caller can do about it.
 */
import { ExternalRequestError, fetchExternalWithRetry } from './http';

const ENDPOINT = 'https://places.googleapis.com/v1';

/** Bounds chosen for a screen a guest is standing in front of, not a batch job. */
const TRANSPORT = { timeoutMs: 6_000, attempts: 2, retryDelayMs: 300, maxResponseBytes: 262_144 } as const;

export type PlacesErrorCode =
  | 'unconfigured' | 'not_found' | 'not_lodging' | 'over_quota' | 'provider' | 'malformed';

const MESSAGES: Readonly<Record<PlacesErrorCode, string>> = {
  unconfigured: 'No Google Places API key is configured.',
  not_found: 'No such place.',
  not_lodging: 'That place is not somewhere a guest stays.',
  over_quota: 'The Places quota is used up for now.',
  provider: 'The Places provider failed.',
  malformed: 'The Places response did not parse.',
};

export class PlacesError extends Error {
  constructor(readonly code: PlacesErrorCode, cause?: unknown) {
    super(MESSAGES[code], { cause });
    this.name = 'PlacesError';
  }
}

export type PlacesOptions = {
  /** Server-side key. Omit and the caller gets `unconfigured`, never a guess. */
  readonly apiKey?: string | undefined;
  readonly signal?: AbortSignal | null;
};

export function requireKey(options: PlacesOptions): string {
  const key = options.apiKey?.trim();
  if (!key) throw new PlacesError('unconfigured');
  return key;
}

function headers(apiKey: string, fields: readonly string[]): Record<string, string> {
  return {
    'content-type': 'application/json',
    // Places (New) bills by field mask and returns everything when none is
    // sent, so an unset mask is both a cost and a privacy question. Every
    // caller passes one built from its own result type.
    'x-goog-fieldmask': fields.join(','),
    'x-goog-api-key': apiKey,
  };
}

/**
 * A 429 outlives the transport's own retry as `provider` with status 429. It
 * is reported apart because the remedy differs: a quota refusal clears by
 * waiting, so a batch should pause rather than mark the business failed.
 */
function transportFailure(error: unknown): PlacesError {
  const overQuota = error instanceof ExternalRequestError && error.status === 429;
  // The key must never reach a log line, so the cause is carried, not stringified.
  return new PlacesError(overQuota ? 'over_quota' : 'provider', error);
}

export async function placesCall(
  path: string, init: RequestInit, apiKey: string, fields: readonly string[],
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchExternalWithRetry(`${ENDPOINT}${path}`, {
      ...init, headers: headers(apiKey, fields),
    }, TRANSPORT);
  } catch (error) {
    throw transportFailure(error);
  }
  if (response.status === 404) throw new PlacesError('not_found');
  if (!response.ok) throw new PlacesError('provider', response.status);
  try {
    return await response.json();
  } catch (error) {
    throw new PlacesError('malformed', error);
  }
}
