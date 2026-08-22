import { createHmac, timingSafeEqual } from 'node:crypto';

import { encryptToken, exchangeOAuthCode, loadTokenKey, squareConfigFromEnv } from '@platform/engine';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/square/callback?code=...&state=<location_id>.<mac> -- exchanges
 * the consent code, encrypts both tokens, and stores the connection for the
 * location the signed state names. Service role: this route is the trust
 * boundary between Square and the database.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const [locationId, mac] = state.split('.');
  if (!code || !locationId || !mac) return new Response('Malformed callback', { status: 400 });

  let config;
  try {
    config = squareConfigFromEnv();
  } catch {
    return new Response('Square is not configured on this deployment.', { status: 501 });
  }
  const expected = createHmac('sha256', config.applicationSecret).update(locationId).digest('hex').slice(0, 32);
  const macBuffer = Buffer.from(mac);
  const expectedBuffer = Buffer.from(expected);
  if (macBuffer.length !== expectedBuffer.length || !timingSafeEqual(macBuffer, expectedBuffer)) {
    return new Response('State signature mismatch', { status: 400 });
  }

  const serviceUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) return new Response('Database is not configured.', { status: 501 });

  const tokens = await exchangeOAuthCode(config, code);
  const key = loadTokenKey();
  const db = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } });

  const { data: location, error: locationError } = await db
    .from('locations').select('id, brand_id').eq('id', locationId).single();
  if (locationError) return new Response('Unknown location', { status: 404 });

  const { data: connection, error: upsertError } = await db
    .from('square_connections')
    .upsert(
      {
        brand_id: location.brand_id,
        location_id: location.id,
        merchant_id: tokens.merchant_id,
        access_token_encrypted: encryptToken(tokens.access_token, key),
        refresh_token_encrypted: encryptToken(tokens.refresh_token, key),
        expires_at: tokens.expires_at,
      },
      { onConflict: 'location_id' },
    )
    .select('id')
    .single();
  if (upsertError) return new Response(`Could not store the connection: ${upsertError.message}`, { status: 500 });

  await db.from('locations').update({ square_connection_id: connection.id }).eq('id', location.id);
  return Response.redirect(new URL('/locations?connected=1', url.origin), 302);
}
