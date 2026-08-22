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
  loadTokenKey,
  squareConfigFromEnv,
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
};

type LocationRow = {
  id: string;
  timezone: string | null;
  square_connection_id: string | null;
  square_connections: ConnectionRow | ConnectionRow[] | null;
};

/** PostgREST returns an embedded to-one as an object or a one-element array. */
function firstConnection(embedded: LocationRow['square_connections']): ConnectionRow | null {
  if (!embedded) return null;
  return Array.isArray(embedded) ? embedded[0] ?? null : embedded;
}

/** Rule 3's numbers are brand columns, not config JSON. */
export type BrandFeeRow = {
  fee_bps: number;
  fee_bps_tier2: number;
  tier_threshold_cents: number;
};

export function feeConfigFrom(brand: BrandFeeRow): FeeConfig {
  return {
    feeBps: Number(brand.fee_bps),
    feeBpsTier2: Number(brand.fee_bps_tier2),
    tierThresholdCents: Number(brand.tier_threshold_cents),
  };
}

/**
 * Resolves the Square runtime for one location, or null when this brand has
 * no Square connection, no application credentials, or no encryption key.
 */
export async function squareRuntimeFor(
  db: SupabaseClient,
  input: { brandId: string; locationId: string; brand: BrandFeeRow },
): Promise<SquareRuntime | null> {
  const { data, error } = await db
    .from('locations')
    .select('id, timezone, square_connection_id, square_connections (square_location_id, access_token_encrypted)')
    .eq('id', input.locationId)
    .eq('brand_id', input.brandId)
    .maybeSingle<LocationRow>();
  if (error) throw error;
  const connection = firstConnection(data?.square_connections ?? null);
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

  return {
    square,
    locationAccessToken,
    squareLocationId: connection.square_location_id,
    feeConfig: feeConfigFrom(input.brand),
    locationTimezone: data.timezone ?? 'America/Denver',
  };
}
