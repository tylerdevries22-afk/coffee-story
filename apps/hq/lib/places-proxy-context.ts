/**
 * The gate in front of the console's Google Places proxy.
 *
 * The proxy exists so the key never leaves the server: the wizard asks this
 * deployment, and this deployment asks Google with a key only it holds. That
 * makes every request here a request billed to the platform, so the gate is
 * the cost control as well as the access control. In order, cheapest refusal
 * first:
 *
 * 1. same origin -- the session is a cookie, and any page can make a browser
 *    send one (same-origin.ts);
 * 2. a per-address budget, before the session lookup costs a GoTrue round trip;
 * 3. a signed-in platform admin -- the same rule as creating an organization,
 *    which is the only thing this search is for. On an unconfigured,
 *    non-production deployment that is the demo session, exactly as it is for
 *    the organization action; production never has one (deployment-mode.ts);
 * 4. a per-admin budget, so one busy tab cannot spend another admin's share
 *    of a shared office address;
 * 5. a configured key -- answered only now, so a stranger cannot learn whether
 *    the deployment has one.
 *
 * The limiter is per instance and not a WAF (rate-limit.ts); the budget cap on
 * the Google project is what bounds a runaway, and this bounds a burst.
 */
import type { ApiErrorBody } from '@platform/api-client';

import { mayProvisionOrganizations } from './auth';
import type { SessionInfo } from './demo-data';
import { requestContext } from './log';
import { clientIdentity, rateLimited } from './rate-limit';
import { sameOriginRequest } from './same-origin';

export type PlacesRoute = 'autocomplete' | 'details';

export type PlacesDeps = {
  /** Who is signed in: `currentSession` in a route, a fixture in a test. */
  readonly session: () => Promise<SessionInfo | null>;
  readonly apiKey: () => string | undefined;
  readonly now?: () => number;
};

export type PlacesContext = {
  readonly apiKey: string;
  readonly actor: string;
  readonly requestId: string;
};

/**
 * Requests per minute. Typing a business name is a handful of debounced
 * lookups; choosing one is a single Details call, and Details is the call
 * that bills, so it gets the tighter budget.
 */
export const PLACES_LIMITS: Readonly<Record<PlacesRoute, { perAddress: number; perAdmin: number }>> = {
  autocomplete: { perAddress: 120, perAdmin: 60 },
  details: { perAddress: 30, perAdmin: 10 },
};

/**
 * The server-side key, read on every request rather than at module load: a
 * rotated key needs no redeploy, and an unset one answers 503 at request time
 * instead of failing the build. Never `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*` --
 * those ship inside a bundle.
 */
export function placesKey(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const key = env.GOOGLE_PLACES_API_KEY?.trim();
  return key ? key : undefined;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * No CORS headers, unlike the bearer-token API: this route is for the
 * console's own pages, and nothing about it should invite a cross-origin read.
 */
export function placesJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function placesError(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return placesJson(body, status);
}

const UNCONFIGURED = 'Google Places is not set up on this deployment. Enter the business details by hand.';

export async function placesRequestContext(
  request: Request,
  route: PlacesRoute,
  deps: PlacesDeps,
): Promise<PlacesContext | Response> {
  if (!sameOriginRequest(request)) {
    return placesError(403, 'forbidden', 'Search Google Places from the console itself.');
  }
  const now = deps.now?.() ?? Date.now();
  const limits = PLACES_LIMITS[route];
  if (rateLimited(clientIdentity(request), `places/${route}-edge`, now, limits.perAddress)) {
    return placesError(429, 'rate_limited', 'Too many searches. Wait a minute and try again.');
  }
  const session = await deps.session();
  if (!session) return placesError(401, 'unauthorized', 'Sign in to search Google Places.');
  if (!mayProvisionOrganizations(session)) {
    return placesError(403, 'forbidden', 'Only a platform administrator can search Google Places.');
  }
  // The demo session has no user id; its email still names one bucket.
  const actor = session.userId ?? `demo:${session.email}`;
  if (rateLimited(actor, `places/${route}`, now, limits.perAdmin)) {
    return placesError(429, 'rate_limited', 'Too many searches. Wait a minute and try again.');
  }
  const apiKey = deps.apiKey();
  if (!apiKey) return placesError(503, 'places_unconfigured', UNCONFIGURED);
  const requestId = String(requestContext(request).requestId);
  return { apiKey, actor, requestId };
}
