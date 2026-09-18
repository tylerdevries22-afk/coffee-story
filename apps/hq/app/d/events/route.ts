import type { NextRequest } from 'next/server';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { DEMO_COOKIE } from '@/lib/demo-entry';
import { recordDemoScreenView, type DemoEventOutcome } from '@/lib/demo-events';
import { log } from '@/lib/log';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';
import { sameOriginRequest } from '@/lib/same-origin';

/**
 * What the demo-runtime guest apps call on every screen change, in demo-
 * runtime mode only (EXPO_PUBLIC_DEMO_RUNTIME=1 -- see apps/customer/index.js
 * and src/demo-runtime/screen-capture.tsx). Same httpOnly cookie, same site
 * resolution and the same shared limiter as every other `/d/` route -- never
 * a second token scheme. No CORS: unlike the bearer-token analytics API this
 * is for the demo runtime's own pages, checked with `sameOriginRequest`
 * instead, and nothing about it should invite a cross-origin call.
 */
export const dynamic = 'force-dynamic';

const CLIENT_EVENTS_PER_MINUTE = 60;
const SITE_EVENTS_PER_MINUTE = 240;
const MAX_BODY_BYTES = 1024;

const STATUS: Readonly<Record<DemoEventOutcome, number>> = {
  accepted: 204,
  invalid: 400,
  not_found: 404,
  rate_limited: 429,
  unavailable: 503,
};

function empty(status: number): Response {
  return new Response(null, { status, headers: { 'cache-control': 'private, no-store' } });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!sameOriginRequest(request)) return empty(403);
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return empty(413);

  let body: unknown = null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return empty(413);
    body = raw ? JSON.parse(raw) : null;
  } catch {
    return empty(400);
  }

  const env = serverEnv();
  const now = Date.now();
  let outcome: DemoEventOutcome;
  try {
    outcome = await recordDemoScreenView(request.cookies.get(DEMO_COOKIE)?.value ?? '', body, {
      db: env ? serviceDb(env) : null,
      clientLimited: rateLimited(clientIdentity(request), 'demo:events', now, CLIENT_EVENTS_PER_MINUTE),
      siteLimited: (siteId) => rateLimited(siteId, 'demo:events:site', now, SITE_EVENTS_PER_MINUTE),
      now: new Date(now),
    });
  } catch (error) {
    log.error('demo.event_failed', {}, error);
    return empty(503);
  }
  return empty(STATUS[outcome]);
}
