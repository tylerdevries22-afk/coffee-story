/**
 * Disconnecting a location's Square account.
 *
 * `revokeOAuthToken` shipped in `packages/engine` with zero callers, and
 * `docs/RUNBOOK.md` told an operator to "revoke the token, delete the row,
 * clear the back-pointer" -- three steps none of which anybody could actually
 * perform, because the first is a TypeScript function and the console had no
 * disconnect at all. So a shop that changed hands, or whose Square account was
 * compromised, had no way to sever the connection: the platform kept a live
 * merchant token encrypted in `square_connections` and kept billing to it.
 *
 * Like device administration, the write runs as the service role and that is
 * not a shortcut: no RLS policy exposes `square_connections` to any client
 * role at all, so the signed-in user's own client cannot read the row it would
 * have to delete. Authorization is therefore decided here, against the
 * caller's claims -- the same `canManageLocation` check `/api/square/connect`
 * makes before it mints consent -- and only then is the write handed over.
 */
import { canManageLocation, type TenantClaims } from '@platform/schema';
import {
  decryptToken,
  encryptToken,
  loadTokenKey,
  revokeOAuthToken,
  squareConfigFromEnv,
  type OAuthTokens,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { queueSquareAccessTokenRetirement } from './square-renewal';

export class SquareAdminError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_request' | 'not_connected', message: string) {
    super(message);
    this.name = 'SquareAdminError';
  }
}

/**
 * How a disconnect ended, in the three states it can actually end in.
 *
 * Not a boolean, because they mean different things to the owner standing at
 * the console. `revoked` is dead everywhere. `local_only` leaves a token that
 * stays spendable at Square for the rest of its thirty days and has to be
 * killed from their Square dashboard by hand. `stranded` is the rare inverse
 * -- Square was told and the row survived -- where the shop reads as connected
 * and cannot take a card, and the fix is to disconnect again.
 */
export type SquareDisconnectOutcome = 'revoked' | 'local_only' | 'stranded';

export type SquareDisconnectResult = { outcome: SquareDisconnectOutcome };

type ConnectionRow = { access_token_encrypted: string };

export type SquareConnectionReplacement =
  | { ok: true; connectionId: string; previousRetirementFailed: boolean }
  | { ok: false; cleanupFailed: boolean };

/** Revoke the seller authorization before removing the local connection. */
export async function revokeSquareAccessToken(
  config: SquareConfig,
  accessToken: string,
): Promise<boolean> {
  try {
    await revokeOAuthToken(config, accessToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically replaces the local connection and retires superseded credentials.
 *
 * A callback has already exchanged its one-time code by the time it reaches
 * this function. If persistence fails, the newly issued access token must be
 * revoked or it becomes an untracked merchant credential. On success, the
 * prior access token is queued for retirement after one cron interval. That
 * grace window lets a checkout/refund request which already resolved the old
 * runtime finish, while keeping a durable record for the authenticated worker.
 */
export async function replaceSquareConnection(
  db: SupabaseClient,
  config: SquareConfig,
  input: {
    brandId: string;
    locationId: string;
    squareLocationId: string;
    tokens: OAuthTokens;
    previousConnection: {
      access_token_encrypted: string;
      refresh_token_encrypted: string;
    } | null;
  },
): Promise<SquareConnectionReplacement> {
  let key: ReturnType<typeof loadTokenKey>;
  try {
    key = loadTokenKey();
  } catch {
    return {
      ok: false,
      cleanupFailed: !await revokeSquareAccessToken(config, input.tokens.access_token),
    };
  }
  let previousAccessToken: string | null = null;
  let previousRetirementFailed = false;
  if (input.previousConnection) {
    try {
      previousAccessToken = decryptToken(input.previousConnection.access_token_encrypted, key);
    } catch {
      previousRetirementFailed = true;
    }
  }

  let stored: { data: { id: string } | null; error: { code?: string } | null };
  try {
    const values = {
      brand_id: input.brandId,
      location_id: input.locationId,
      merchant_id: input.tokens.merchant_id,
      square_location_id: input.squareLocationId,
      access_token_encrypted: encryptToken(input.tokens.access_token, key),
      refresh_token_encrypted: encryptToken(input.tokens.refresh_token, key),
      expires_at: input.tokens.expires_at,
    };
    if (input.previousConnection) {
      stored = await db
        .from('square_connections')
        .update(values)
        .eq('location_id', input.locationId)
        .eq('brand_id', input.brandId)
        .eq('access_token_encrypted', input.previousConnection.access_token_encrypted)
        .eq('refresh_token_encrypted', input.previousConnection.refresh_token_encrypted)
        .select('id')
        .maybeSingle<{ id: string }>();
    } else {
      stored = await db
        .from('square_connections')
        .insert(values)
        .select('id')
        .single<{ id: string }>();
    }
  } catch {
    return {
      ok: false,
      cleanupFailed: !await revokeSquareAccessToken(config, input.tokens.access_token),
    };
  }
  if (stored.error || !stored.data?.id) {
    return {
      ok: false,
      cleanupFailed: !await revokeSquareAccessToken(config, input.tokens.access_token),
    };
  }

  if (previousAccessToken && previousAccessToken !== input.tokens.access_token) {
    previousRetirementFailed = !await queueSquareAccessTokenRetirement(db, {
      brandId: input.brandId,
      locationId: input.locationId,
      accessTokenEncrypted: input.previousConnection!.access_token_encrypted,
    });
  }
  return {
    ok: true,
    connectionId: stored.data.id,
    previousRetirementFailed,
  };
}

/**
 * Records the console-facing pointer only after the authoritative connection
 * row is complete.
 *
 * `square_connections.location_id` is authoritative for payment resolution
 * and the console status view; `locations.square_connection_id` is a legacy
 * relational back-pointer. The callback keeps it synchronized for diagnostics
 * and compatibility, but a failure cannot make the usable authorization a
 * failed one. Returning false also covers a location deleted between callback
 * authorization and this final write; PostgREST considers a zero-row update
 * successful unless the row is selected back.
 */
export async function recordSquareConnectionPointer(
  db: SupabaseClient,
  input: { brandId: string; locationId: string; connectionId: string },
): Promise<boolean> {
  try {
    const linked = await db
      .from('locations')
      .update({ square_connection_id: input.connectionId })
      .eq('id', input.locationId)
      .eq('brand_id', input.brandId)
      .select('id')
      .maybeSingle<{ id: string }>();
    return !linked.error && linked.data?.id === input.locationId;
  } catch {
    return false;
  }
}

/**
 * Severs one location's Square connection, telling Square first.
 *
 * The order is deliberate and is the whole security argument: the stored
 * ciphertext is the only copy of the token the platform has, so deleting it
 * before Square has been told would leave a live merchant token that nothing
 * can ever revoke. Told first, the worst case is a row that outlives a dead
 * token -- which reads as "not connected" on the next order and is fixed by
 * disconnecting again.
 *
 * The local teardown then happens whether or not Square answered. Refusing it
 * would trap an owner disconnecting *because* something is wrong: the platform
 * would keep taking that shop's card payments to a merchant they no longer
 * trust, on the grounds that the merchant could not be reached.
 */
export async function disconnectSquare(
  db: SupabaseClient,
  claims: TenantClaims,
  locationId: string,
): Promise<SquareDisconnectResult> {
  // A guest carries a brand but no role.
  if (!claims.role) throw new SquareAdminError('forbidden', 'Only staff can disconnect Square.');
  if (!locationId) throw new SquareAdminError('invalid_request', 'locationId is required.');
  if (!canManageLocation(claims, locationId)) {
    throw new SquareAdminError('forbidden', 'That location is not yours to disconnect.');
  }

  const found = await db
    .from('square_connections')
    .select('access_token_encrypted')
    .eq('location_id', locationId)
    .eq('brand_id', claims.brand_id)
    .maybeSingle<ConnectionRow>();
  if (found.error) throw new SquareAdminError('invalid_request', found.error.message);
  if (!found.data) throw new SquareAdminError('not_connected', 'That location is not connected to Square.');

  let config: SquareConfig | null = null;
  let accessToken: string | null = null;
  try {
    config = squareConfigFromEnv();
    accessToken = decryptToken(found.data.access_token_encrypted, loadTokenKey());
  } catch {
    // Missing application credentials, or a token key this deployment cannot
    // load -- the case docs/RUNBOOK.md already describes for a rotated key.
    // The row still has to go; Square simply cannot be told from here.
    config = null;
  }

  let revokedAtSquare = false;
  if (config && accessToken) {
    // Already-revoked, expired, or unreachable all leave the owner with the
    // same job, and the caller says so in the same sentence.
    revokedAtSquare = await revokeSquareAccessToken(config, accessToken);
  }

  const removed = await db
    .from('square_connections')
    .delete()
    .eq('location_id', locationId)
    .eq('brand_id', claims.brand_id)
    // Do not let an older disconnect erase credentials written by a reconnect
    // while Square was answering the revocation request.
    .eq('access_token_encrypted', found.data.access_token_encrypted)
    .select('location_id')
    .maybeSingle<{ location_id: string }>();
  // `locations.square_connection_id` references this row `on delete set null`
  // (0005), so the compatibility back-pointer clears itself.

  // A failed delete is reported, not thrown: by this point the token may
  // already be dead at Square, and "nothing was changed" would be a lie about
  // money on the one path where the owner most needs the truth.
  if (removed.error || removed.data?.location_id !== locationId) return { outcome: 'stranded' };
  return { outcome: revokedAtSquare ? 'revoked' : 'local_only' };
}
