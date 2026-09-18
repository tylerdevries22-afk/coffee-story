import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { demoBuilder } from '@/lib/demo-builder';
import { DEMO_COOKIE } from '@/lib/demo-entry';
import { demoPackResponse, type DemoPackOutcome } from '@/lib/demo-pack-response';
import { log } from '@/lib/log';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

/**
 * What a guest-app runtime export fetches before it starts the app at all
 * (see apps/customer/index.js and apps/kiosk/index.js): the whole demo,
 * reshaped into what the real customer/kiosk bundle already knows how to
 * read. Public by design (middleware lists `/d/`) and gated the same way
 * every other `/d/` path is -- the httpOnly cookie set by `/d/[token]` -- so
 * this exposes nothing `/d/view`'s own HTML does not already render for the
 * same visitor.
 */
export const dynamic = 'force-dynamic';

const PACKS_PER_MINUTE = 30;

function unavailable(status: number): Response {
  return NextResponse.json({ error: 'unavailable' }, { status, headers: { 'cache-control': 'private, no-store' } });
}

export async function GET(request: NextRequest): Promise<Response> {
  if (rateLimited(clientIdentity(request), 'demo:pack', Date.now(), PACKS_PER_MINUTE)) return unavailable(429);
  const env = serverEnv();
  const token = request.cookies.get(DEMO_COOKIE)?.value ?? '';
  let outcome: DemoPackOutcome;
  try {
    outcome = await demoPackResponse(token, {
      db: env ? serviceDb(env) : null, builder: demoBuilder(), now: new Date(),
    });
  } catch (error) {
    log.error('demo.pack_failed', {}, error);
    return unavailable(503);
  }
  if (outcome.kind === 'unavailable') return unavailable(503);
  if (outcome.kind === 'not_found') return unavailable(404);
  return NextResponse.json(outcome.pack, { headers: { 'cache-control': 'private, no-store' } });
}
