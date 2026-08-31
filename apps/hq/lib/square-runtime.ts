/**
 * A location's Square connection, resolved and decrypted for one request.
 *
 * Everything the money paths need lives behind this: the application
 * credentials from the server environment, the location's own access token
 * (AES-256-GCM in square_connections, decrypted here and never persisted in
 * the clear), the merchant's Square location id, and the brand's fee config.
 *
 * Returns null rather than throwing when the brand simply has not connected
 * Square yet — that is the normal state of a new tenant, and every caller
 * turns it into "this tender is not available", not an error.
 *
 * Env is read per-request for the same reason as api-auth.ts: the routes must
 * stay importable by tests and must degrade instead of crashing a build.
 */
import {
  decryptToken,
  encryptToken,
  loadTokenKey,
  refreshOAuthToken,
  squareConfigFromEnv,
  squareTokenState,
  resolveFeeConfig,
  type BrandFeeTerms,
  type FeeConfig,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SquareRuntime = {
  square: SquareConfig;
  locationAccessToken: string;
  squareLocationId: string;
  feeConfig: FeeConfig;
  locationTimezone: string;
};

type ConnectionRow = {
  square_location_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
};

type LocationRow = {
  id: string;
  timezone: string | null;
  // Nullable per-location overrides of rule 3's brand numbers (0039). A
  // franchise does not have one fee schedule; NULL inherits the brand.
  fee_bps: number | null;
  fee_bps_tier2: number | null;
  tier_threshold_cents: number | null;
};

/** Rule 3's numbers are brand columns, not config JSON. */
export type BrandFeeRow = BrandFeeTerms;

/**
 * Resolves the Square runtime for one location, or null when this brand has
 * no Square connection, no application credentials, or no encryption key.
 */
export async function squareRuntimeFor(
  db: SupabaseClient,
  input: { brandId: string; locationId: string; brand: BrandFeeRow },
): Promise<SquareRuntime | null> {
  // Read the two rows separately rather than embedding them: locations and
  // square_connections reference each other (the connection names its
  // location; the location keeps a back-pointer), and PostgREST refuses an
  // ambiguous embed across two relationships. square_connections.location_id
  // is the authoritative side — it is UNIQUE and written in the same upsert
  // that stores the tokens, while the back-pointer is a second, best-effort
  // write that a failed request could leave unset.
  const [location, connectionRow] = await Promise.all([
    db.from('locations')
      .select('id, timezone, fee_bps, fee_bps_tier2, tier_threshold_cents')
      .eq('id', input.locationId)
      .eq('brand_id', input.brandId)
      .maybeSingle<LocationRow>(),
    db.from('square_connections')
      .select('square_location_id, access_token_encrypted, refresh_token_encrypted, expires_at')
      .eq('location_id', input.locationId)
      .eq('brand_id', input.brandId)
      .maybeSingle<ConnectionRow>(),
  ]);
  if (location.error) throw location.error;
  if (connectionRow.error) throw connectionRow.error;
  const data = location.data;
  const connection = connectionRow.data;
  if (!data || !connection?.square_location_id) return null;

  let square: SquareConfig;
  let locationAccessToken: string;
  try {
    square = squareConfigFromEnv();
    locationAccessToken = decryptToken(connection.access_token_encrypted, loadTokenKey());
  } catch {
    // Credentials or the token key are missing from this deployment's
    // environment: the connection row exists but cannot be used.
    return null;
  }

  // Square access tokens last thirty days. `refreshOAuthToken` shipped with
  // nothing calling it and `expires_at` was written and never read, so every
  // connected shop would have stopped taking cards a month after connecting,
  // on a 401 nothing in the product explained. The first runtime resolution
  // after day seven renews the token (23 days remain); keeping this lazy
  // backstop means a stopped maintenance job cannot strand the next sale.
  const state = squareTokenState(connection.expires_at, Date.now());
  if (state !== 'fresh' && connection.refresh_token_encrypted) {
    const renewal = await renewAccessToken(db, square, {
      brandId: input.brandId,
      locationId: input.locationId,
      refreshTokenEncrypted: connection.refresh_token_encrypted,
    });
    if (renewal.outcome === 'renewed') locationAccessToken = renewal.accessToken;
    // A failed compare-and-set means another request disconnected, reconnected,
    // or renewed this location while Square was answering. The connection we
    // read above is stale, including its merchant location and access token, so
    // this order must resolve the runtime again instead of spending either one.
    else if (renewal.outcome === 'stale') return null;
    // A token inside the margin has not expired yet, so a failed renewal still
    // takes the sale. An expired one must not be sent to Square as if it were
    // money: the caller turns null into "this tender is not available", which
    // is the truth.
    else if (state === 'expired') return null;
  } else if (state === 'expired') return null;

  return {
    square,
    locationAccessToken,
    squareLocationId: connection.square_location_id,
    feeConfig: resolveFeeConfig(input.brand, data),
    locationTimezone: data.timezone ?? 'America/Denver',
  };
}

/**
 * Trades the stored refresh token for a new access token and persists both.
 *
 * Separates a failed call to Square from a stale database write. The former
 * can safely fall back to a still-valid access token. The latter means the
 * entire connection snapshot may have been replaced and must fail closed.
 */
type RenewalResult =
  | { outcome: 'renewed'; accessToken: string }
  | { outcome: 'failed' }
  | { outcome: 'stale' };

async function renewAccessToken(
  db: SupabaseClient,
  square: SquareConfig,
  input: { brandId: string; locationId: string; refreshTokenEncrypted: string },
): Promise<RenewalResult> {
  let accessToken: string;
  let update: Record<string, string>;
  try {
    const key = loadTokenKey();
    const tokens = await refreshOAuthToken(square, decryptToken(input.refreshTokenEncrypted, key));
    if (!tokens.access_token) return { outcome: 'failed' };
    accessToken = tokens.access_token;
    update = {
      access_token_encrypted: encryptToken(tokens.access_token, key),
      ...(tokens.refresh_token ? { refresh_token_encrypted: encryptToken(tokens.refresh_token, key) } : {}),
      expires_at: tokens.expires_at,
    };
  } catch {
    return { outcome: 'failed' };
  }

  try {
    // Only the connection whose refresh token we traded may receive the new
    // credentials. A disconnect or reconnect can replace that authorization
    // while Square is answering; writing by location alone would then splice
    // an old merchant's token into the new connection. The selected row also
    // distinguishes a real write from PostgREST's successful zero-row result.
    const persisted = await db
      .from('square_connections')
      .update(update)
      .eq('location_id', input.locationId)
      .eq('brand_id', input.brandId)
      .eq('refresh_token_encrypted', input.refreshTokenEncrypted)
      .select('location_id')
      .maybeSingle<{ location_id: string }>();
    return !persisted.error && persisted.data?.location_id === input.locationId
      ? { outcome: 'renewed', accessToken }
      : { outcome: 'stale' };
  } catch {
    return { outcome: 'stale' };
  }
}
