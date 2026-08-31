import {
  chooseSquareLocation,
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
import {
  recordSquareConnectionPointer,
  replaceSquareConnection,
  revokeSquareAccessToken,
} from '../../../../lib/square-admin';
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

  // Fail before exchanging Square's one-time code if this deployment cannot
  // encrypt what comes back. Otherwise Square would issue a live credential
  // that the platform can neither store nor revoke.
  try {
    loadTokenKey();
  } catch {
    return new Response('Square token encryption is not configured on this deployment.', { status: 501 });
  }

  // Read the credential that a reconnect will replace before exchanging the
  // code. A database outage after the exchange would otherwise strand the new
  // token before the callback even reached its guarded upsert.
  const previous = await db
    .from('square_connections')
    .select('access_token_encrypted, refresh_token_encrypted')
    .eq('location_id', decision.locationId)
    .eq('brand_id', location!.brand_id)
    .maybeSingle<{ access_token_encrypted: string; refresh_token_encrypted: string }>();
  if (previous.error) {
    return new Response('Could not prepare the Square connection. Try again from Locations.', { status: 500 });
  }

  let tokens: Awaited<ReturnType<typeof exchangeOAuthCode>>;
  try {
    tokens = await exchangeOAuthCode(config, code);
  } catch {
    return Response.redirect(new URL('/locations?square=authorization_failed', url.origin), 302);
  }

  const refuseIssuedGrant = async (reason: string): Promise<Response> => {
    const revoked = await revokeSquareAccessToken(config, tokens.access_token);
    const target = new URL(`/locations?square=${reason}`, url.origin);
    if (!revoked) target.searchParams.set('square_warning', 'issued_token_active');
    return Response.redirect(target, 302);
  };

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
    return refuseIssuedGrant('unreachable');
  }
  if (!chosen.ok) {
    return refuseIssuedGrant(chosen.reason);
  }

  const replacement = await replaceSquareConnection(db, config, {
    brandId: location!.brand_id,
    locationId: decision.locationId,
    squareLocationId: chosen.location.id,
    tokens,
    previousConnection: previous.data ?? null,
  });
  if (!replacement.ok) {
    console.error('Square connection could not be stored.', {
      brandId: location!.brand_id,
      locationId: decision.locationId,
      cleanupFailed: replacement.cleanupFailed,
    });
    const target = new URL('/locations?square=storage_failed', url.origin);
    if (replacement.cleanupFailed) target.searchParams.set('square_warning', 'issued_token_active');
    return Response.redirect(target, 302);
  }

  // Keep the legacy back-pointer synchronized after the authoritative row is
  // complete. Checkout and the console both read square_connections directly,
  // so a failed compatibility write is logged but cannot turn a working
  // authorization into a false failure page.
  const linked = await recordSquareConnectionPointer(db, {
    brandId: location!.brand_id,
    locationId: decision.locationId,
    connectionId: replacement.connectionId,
  });
  if (!linked) {
    console.warn('Square connection back-pointer was not synchronized.', {
      brandId: location!.brand_id,
      locationId: decision.locationId,
      connectionId: replacement.connectionId,
    });
  }
  const target = new URL('/locations?connected=1', url.origin);
  if (replacement.previousRetirementFailed) {
    console.warn('Previous Square access token retirement was not queued.', {
      brandId: location!.brand_id,
      locationId: decision.locationId,
    });
    target.searchParams.set('square_warning', 'previous_token_active');
  }
  return Response.redirect(target, 302);
}
