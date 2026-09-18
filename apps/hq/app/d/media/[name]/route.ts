import type { NextRequest } from 'next/server';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { DEMO_COOKIE } from '@/lib/demo-entry';
import { demoMedia } from '@/lib/demo-site';
import { log } from '@/lib/log';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

/**
 * One image of the demo this browser opened. The bucket is private; this is
 * the only way out of it, and it answers only for a live demo named by the
 * visitor's own cookie, only for a name that cannot leave that demo's folder.
 * Anything else is the same bare 404, so a probe learns nothing.
 */
export const dynamic = 'force-dynamic';

const IMAGES_PER_MINUTE = 240;

function missing(status = 404): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await context.params;
  if (rateLimited(clientIdentity(request), 'demo:media', Date.now(), IMAGES_PER_MINUTE)) return missing(429);
  const env = serverEnv();
  const token = request.cookies.get(DEMO_COOKIE)?.value ?? '';
  if (!env || !token) return missing();
  try {
    const image = await demoMedia(serviceDb(env), token, name);
    if (!image) return missing();
    return new Response(image.body, {
      headers: {
        'content-type': image.contentType,
        // Private: the same URL answers differently per visitor's cookie.
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    });
  } catch (error) {
    log.error('demo.media_failed', {}, error);
    return missing(503);
  }
}
