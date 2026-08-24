import { oauthAuthorizeUrl, squareConfigFromEnv } from '@platform/engine';
import { canManageLocation, parseTenantClaims } from '@platform/schema';

import { encodeOAuthState, STATE_TTL_SECONDS } from '../../../../lib/square-oauth-state';
import { serverClient } from '../../../../lib/supabase-server';
import { tokenAppMetadata } from '../../../../lib/token-claims';

/**
 * GET /api/square/connect?location_id=... — sends the signed-in owner into
 * Square's OAuth consent for one of their own locations.
 *
 * This route mints the credential the callback trusts, so it is an
 * authorization boundary, not a redirect helper. It used to be neither: it
 * took a location id from the query string, signed it, and redirected —
 * without asking who was calling. Location ids are readable with the public
 * anon key, so anyone could obtain a valid state for another brand's shop,
 * complete consent with their own Square account, and have that shop's card
 * payments land in it.
 *
 * Middleware cannot cover this: /api/ is public there by design (the platform
 * API authenticates per request with a bearer token). This route authenticates
 * itself, against the console's own cookie session.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const locationId = url.searchParams.get('location_id');
  if (!locationId) return new Response('location_id is required', { status: 400 });

  const supabase = await serverClient();
  if (!supabase) return new Response('This deployment has no Supabase configuration.', { status: 501 });
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return Response.redirect(new URL('/login', url.origin), 302);

  // getUser verifies the token with GoTrue rather than trusting the cookie.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return Response.redirect(new URL('/login', url.origin), 302);

  // Hook-minted claims live in the token payload, not in the stored metadata.
  const claims = parseTenantClaims(tokenAppMetadata(session.access_token));
  if (!claims?.role) return new Response('Only staff can connect Square.', { status: 403 });
  if (!canManageLocation(claims, locationId)) {
    return new Response('That location is not yours to connect.', { status: 403 });
  }

  // The claim says which brand; the row must agree. A location id from
  // another tenant fails here even if the claim looked plausible.
  const { data: location, error: locationError } = await supabase
    .from('locations')
    .select('id, brand_id')
    .eq('id', locationId)
    .maybeSingle<{ id: string; brand_id: string }>();
  if (locationError) return new Response('Could not read that location.', { status: 500 });
  if (!location || location.brand_id !== claims.brand_id) {
    return new Response('That location is not yours to connect.', { status: 403 });
  }

  let config;
  try {
    config = squareConfigFromEnv();
  } catch (error) {
    return new Response(
      `Square is not configured on this deployment: ${error instanceof Error ? error.message : 'missing env'}`,
      { status: 501 },
    );
  }

  const state = encodeOAuthState(config.applicationSecret, {
    locationId,
    userId: userData.user.id,
    expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  });
  return Response.redirect(oauthAuthorizeUrl(config, state), 302);
}
