import { createHmac } from 'node:crypto';

import { oauthAuthorizeUrl, squareConfigFromEnv } from '@platform/engine';

/**
 * GET /api/square/connect?location_id=... -- sends the browser into Square's
 * OAuth consent. state carries the location id plus an HMAC so the callback
 * can trust it round-tripped unmodified.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const locationId = url.searchParams.get('location_id');
  if (!locationId) return new Response('location_id is required', { status: 400 });
  let config;
  try {
    config = squareConfigFromEnv();
  } catch (error) {
    return new Response(
      `Square is not configured on this deployment: ${error instanceof Error ? error.message : 'missing env'}`,
      { status: 501 },
    );
  }
  const mac = createHmac('sha256', config.applicationSecret).update(locationId).digest('hex').slice(0, 32);
  return Response.redirect(oauthAuthorizeUrl(config, `${locationId}.${mac}`), 302);
}
