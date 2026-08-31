import {
  chooseSquareLocation,
  encryptToken,
  exchangeOAuthCode,
  listSquareLocations,
  loadTokenKey,
  squareConfigFromEnv,
  type SquareLocationChoice,
} from '@platform/engine';
import { parseTenantClaims } from '@platform/schema';
import { createClient } from '@supabase/supabase-js';

import { authorizeSquareCallback, refusalResponse } from '../../../../lib/square-callback-auth';
import { decodeOAuthState } from '../../../../lib/square-oauth-state';
import { serverClient } from '../../../../lib/supabase-server';
import { tokenAppMetadata } from '../../../../lib/token-claims';

/**
 * GET /api/square/callback?code=...&state=... — exchanges the consent code,
 * encrypts both tokens, and stores the connection for the location the signed
 * state names. Service role: this route is the trust boundary between Square
 * and the database, so it decides who owns a shop's card payments.
 *
 * The state hardening that bound state to a user and an expiry landed in
 * `/api/square/connect` and `lib/square-oauth-state.ts` and never reached this
 * file, which went on verifying the old `<location_id>.<mac>` format. That left
 * two live defects at once:
 *
 *  - any state minted under the old scheme still verified, with no expiry and
 *    no user binding. Those were issued to unauthenticated callers for any
 *    location id, so replaying one here with the attacker's own consent code
 *    repointed that shop's `square_connections` row at the attacker's merchant
 *    account, and its takings with it;
 *  - a state from the current `connect` route splits to `locationId = 'v1'`,
 *    so every honest attempt died on "State signature mismatch". No location
 *    could connect Square at all.
 *
 * So: verify the state the way it is minted, then re-check the person. A state
 * proves the request was started by someone who could manage the location; it
 * cannot prove they still can, or that the browser finishing consent is
 * theirs. Both are checked here against the console's own cookie session.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (!code) return new Response('Malformed callback', { status: 400 });

  let config;
  try {
    config = squareConfigFromEnv();
  } catch {
    return new Response('Square is not configured on this deployment.', { status: 501 });
  }

  // Which location the state names, so the row can be read before deciding.
  // Nothing is trusted from this until authorizeSquareCallback agrees.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const named = decodeOAuthState(config.applicationSecret, state, nowSeconds);
  if (!named.ok) {
    const refusal = refusalResponse('invalid_state');
    return new Response(refusal.body, { status: refusal.status });
  }

  const supabase = await serverClient();
  if (!supabase) return new Response('This deployment has no Supabase configuration.', { status: 501 });
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) return Response.redirect(new URL('/login', url.origin), 302);

  // getUser verifies the token with GoTrue rather than trusting the cookie.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return Response.redirect(new URL('/login', url.origin), 302);

  const serviceUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) return new Response('Database is not configured.', { status: 501 });
  const db = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } });

  const { data: location, error: locationError } = await db
    .from('locations').select('id, brand_id').eq('id', named.state.locationId)
    .maybeSingle<{ id: string; brand_id: string }>();
  if (locationError) return new Response('Could not read that location.', { status: 500 });

  const decision = authorizeSquareCallback({
    secret: config.applicationSecret,
    state,
    nowSeconds,
    sessionUserId: userData.user.id,
    claims: parseTenantClaims(tokenAppMetadata(session.access_token)),
    locationBrandId: location?.brand_id ?? null,
  });
  if (!decision.ok) {
    const refusal = refusalResponse(decision.reason);
    return new Response(refusal.body, { status: refusal.status });
  }

  const tokens = await exchangeOAuthCode(config, code);

  // Which of the merchant's Square locations this shop bills against.
  //
  // This step was missing, and its absence was silent: consent stored the
  // tokens and set the back-pointer, the console drew "Connected" and dropped
  // the retry button, and `square_connections.square_location_id` stayed null
  // -- which is exactly what `squareRuntimeFor` returns null on. Every card
  // order then answered 503 "not connected for this location yet", with
  // nothing in the product able to fix it.
  //
  // Resolved before anything is written, so a re-connect that cannot pick a
  // location leaves a working one alone instead of blanking it.
  let chosen: SquareLocationChoice;
  try {
    chosen = chooseSquareLocation(await listSquareLocations(config, tokens.access_token));
  } catch {
    return Response.redirect(new URL('/locations?square=unreachable', url.origin), 302);
  }
  if (!chosen.ok) {
    return Response.redirect(new URL(`/locations?square=${chosen.reason}`, url.origin), 302);
  }

  const key = loadTokenKey();

  const { data: connection, error: upsertError } = await db
    .from('square_connections')
    .upsert(
      {
        brand_id: location!.brand_id,
        location_id: decision.locationId,
        merchant_id: tokens.merchant_id,
        square_location_id: chosen.location.id,
        access_token_encrypted: encryptToken(tokens.access_token, key),
        refresh_token_encrypted: encryptToken(tokens.refresh_token, key),
        expires_at: tokens.expires_at,
      },
      { onConflict: 'location_id' },
    )
    .select('id')
    .single();
  if (upsertError) return new Response(`Could not store the connection: ${upsertError.message}`, { status: 500 });

  // The console reads this back-pointer as "Connected" and hides the retry
  // button behind it, so it is set last -- only once there is a Square
  // location to bill against and the shop really can take a card.
  await db.from('locations').update({ square_connection_id: connection.id }).eq('id', decision.locationId);
  return Response.redirect(new URL('/locations?connected=1', url.origin), 302);
}
