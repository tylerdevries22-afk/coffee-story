import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { demoBuilder } from '@/lib/demo-builder';
import { DEMO_VIEW_PATH, demoEntry } from '@/lib/demo-entry';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

/**
 * The link in a prospect's email. Public by design (middleware lists `/d/`):
 * the token is the credential, and it is checked in lib/demo-entry.ts before
 * anything else happens. Tokens are 256-bit, so the limit here protects the
 * database from a flood rather than the tokens from guessing.
 */
export const dynamic = 'force-dynamic';

const OPENS_PER_MINUTE = 30;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  const env = serverEnv();
  const outcome = await demoEntry(token, {
    db: env ? serviceDb(env) : null,
    builder: demoBuilder(),
    limited: rateLimited(clientIdentity(request), 'demo:open', Date.now(), OPENS_PER_MINUTE),
    now: new Date(),
    secure: process.env.NODE_ENV === 'production',
  });
  if (outcome.kind === 'rate_limited') {
    return new Response('Too many requests. Try again in a minute.', {
      status: 429,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' },
    });
  }
  const view = new URL(DEMO_VIEW_PATH, request.url);
  if (outcome.kind === 'invalid' || outcome.kind === 'unavailable') view.searchParams.set('link', outcome.kind);
  const response = NextResponse.redirect(view, 303);
  if (outcome.kind === 'opened' || outcome.kind === 'unopened') {
    response.cookies.set(outcome.cookie.name, outcome.cookie.value, outcome.cookie.options);
  }
  response.headers.set('cache-control', 'no-store');
  return response;
}
