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
  // on a 401 nothing in the product explained. Renewing here rather than on a
  // schedule means it happens exactly when a sale needs it, and cannot be
  // silently skipped by a cron that stopped running.
  const state = squareTokenState(connection.expires_at, Date.now());
  if (state !== 'fresh' && connection.refresh_token_encrypted) {
    const renewed = await renewAccessToken(db, square, {
      locationId: input.locationId,
      refreshTokenEncrypted: connection.refresh_token_encrypted,
    });
    if (renewed) locationAccessToken = renewed;
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
 * Returns null on any failure -- a network error, a refresh token Square has
 * revoked, or a write that lost a race with a concurrent order. The caller
 * decides what that means, because it depends on whether the token it already
 * holds is still spendable.
 */
async function renewAccessToken(
  db: SupabaseClient,
  square: SquareConfig,
  input: { locationId: string; refreshTokenEncrypted: string },
): Promise<string | null> {
  try {
    const key = loadTokenKey();
    const tokens = await refreshOAuthToken(square, decryptToken(input.refreshTokenEncrypted, key));
    if (!tokens.access_token) return null;
    // The new token is good whether or not this write lands; a failed write only
    // means the next order renews again, so the result is deliberately ignored.
    await db
      .from('square_connections')
      .update({
        access_token_encrypted: encryptToken(tokens.access_token, key),
        // Square reissues the refresh token on some grants and echoes the old
        // one otherwise, so writing whichever came back is correct either way.
        ...(tokens.refresh_token ? { refresh_token_encrypted: encryptToken(tokens.refresh_token, key) } : {}),
        expires_at: tokens.expires_at,
      })
      .eq('location_id', input.locationId);
    return tokens.access_token;
  } catch {
    return null;
  }
}
