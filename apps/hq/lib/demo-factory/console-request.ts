/**
 * The gate in front of the demo factory's console routes.
 *
 * They answer the console's cookie session, not a bearer token, and what
 * they hand back -- a day's outreach drafts, with the addresses businesses
 * publish -- is platform data about real people, so the order is the Places
 * proxy's (places-proxy-context.ts), cheapest refusal first:
 *
 * 1. same origin -- any page can make a browser send the session cookie;
 * 2. a per-address budget, before the session lookup costs a round trip;
 * 3. a signed-in platform admin, the only role that runs the factory;
 * 4. a per-admin budget.
 *
 * The limiter is per instance and not a WAF (rate-limit.ts); this bounds a
 * burst from a stuck tab, not an attacker.
 */
import { mayProvisionOrganizations } from '../auth';
import type { SessionInfo } from '../demo-data';
import { requestContext } from '../log';
import { clientIdentity, rateLimited } from '../rate-limit';
import { sameOriginRequest } from '../same-origin';

export type DemoConsoleRoute = 'outreach';

export type DemoConsoleDeps = {
  /** Who is signed in: `currentSession` in a route, a fixture in a test. */
  readonly session: () => Promise<SessionInfo | null>;
  readonly now?: () => number;
};

export type DemoConsoleContext = { readonly actor: string; readonly requestId: string };

/** Requests per minute. An export is one click; these only stop a loop. */
export const DEMO_CONSOLE_LIMITS: Readonly<Record<DemoConsoleRoute, { perAddress: number; perAdmin: number }>> = {
  outreach: { perAddress: 30, perAdmin: 10 },
};

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function demoConsoleContext(
  request: Request,
  route: DemoConsoleRoute,
  deps: DemoConsoleDeps,
): Promise<DemoConsoleContext | Response> {
  if (!sameOriginRequest(request)) return refuse(403, 'Use the demo factory from the console itself.');
  const now = deps.now?.() ?? Date.now();
  const limits = DEMO_CONSOLE_LIMITS[route];
  if (rateLimited(clientIdentity(request), `demos/${route}-edge`, now, limits.perAddress)) {
    return refuse(429, 'Too many requests. Wait a minute and try again.');
  }
  const session = await deps.session();
  if (!session) return refuse(401, 'Sign in to use the demo factory.');
  if (!mayProvisionOrganizations(session)) return refuse(403, 'Only a platform administrator can use the demo factory.');
  // The demo session has no user id; its email still names one bucket.
  const actor = session.userId ?? `demo:${session.email}`;
  if (rateLimited(actor, `demos/${route}`, now, limits.perAdmin)) {
    return refuse(429, 'Too many requests. Wait a minute and try again.');
  }
  return { actor, requestId: String(requestContext(request).requestId) };
}
