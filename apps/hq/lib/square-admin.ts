import { randomUUID } from 'node:crypto';

import {
  decryptToken,
  loadTokenKey,
  squareConfigFromEnv,
  type SquareConfig,
} from '@platform/engine';
import { canManageLocation, type TenantClaims } from '@platform/schema';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  claimSquareConnectionMutation,
  failSquareConnectionMutation,
  finalizeSquareConnectionDisconnect,
  type SquareConnectionSnapshot,
} from './square-connection-mutation';
import { revokeSquareAccessToken } from './square-connection-replacement';

export {
  replaceSquareConnection,
  revokeSquareAccessToken,
  type SquareConnectionReplacement,
} from './square-connection-replacement';

export class SquareAdminError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_request' | 'not_connected', message: string) {
    super(message);
    this.name = 'SquareAdminError';
  }
}

export type SquareDisconnectOutcome = 'revoked' | 'in_flight' | 'changed' | 'stranded' | 'failed';
export type SquareDisconnectResult = { outcome: SquareDisconnectOutcome };

/** Synchronize the legacy location pointer after the authoritative row exists. */
export async function recordSquareConnectionPointer(
  db: SupabaseClient,
  input: { brandId: string; locationId: string; connectionId: string },
): Promise<boolean> {
  try {
    const linked = await db.from('locations')
      .update({ square_connection_id: input.connectionId })
      .eq('id', input.locationId).eq('brand_id', input.brandId)
      .select('id').maybeSingle<{ id: string }>();
    return !linked.error && linked.data?.id === input.locationId;
  } catch { return false; }
}

function authorizeDisconnect(claims: TenantClaims, locationId: string): void {
  if (!claims.role) throw new SquareAdminError('forbidden', 'Only staff can disconnect Square.');
  if (!locationId) throw new SquareAdminError('invalid_request', 'locationId is required.');
  if (!canManageLocation(claims, locationId)) {
    throw new SquareAdminError('forbidden', 'That location is not yours to disconnect.');
  }
}

async function loadConnection(
  db: SupabaseClient, brandId: string, locationId: string,
): Promise<SquareConnectionSnapshot> {
  const found = await db.from('square_connections')
    .select('id, connection_generation, access_token_encrypted, refresh_token_encrypted')
    .eq('location_id', locationId).eq('brand_id', brandId)
    .maybeSingle<SquareConnectionSnapshot>();
  if (found.error) throw new SquareAdminError('invalid_request', 'Could not read that connection.');
  if (!found.data) {
    throw new SquareAdminError('not_connected', 'That location is not connected to Square.');
  }
  return found.data;
}

async function releaseFailedClaim(
  db: SupabaseClient, brandId: string, locationId: string, generation: string,
): Promise<SquareDisconnectResult> {
  const released = await failSquareConnectionMutation(db, {
    brandId, locationId, generation, code: 'disconnect_not_attempted',
  });
  return { outcome: released ? 'failed' : 'stranded' };
}

/** Fence new charges, revoke the seller grant, then delete the exact snapshot. */
export async function disconnectSquare(
  db: SupabaseClient,
  claims: TenantClaims,
  locationId: string,
): Promise<SquareDisconnectResult> {
  authorizeDisconnect(claims, locationId);
  const expected = await loadConnection(db, claims.brand_id, locationId);
  const generation = randomUUID();
  const claimed = await claimSquareConnectionMutation(db, {
    brandId: claims.brand_id, locationId, generation, kind: 'disconnect', expected,
  });
  if (!claimed.ok) {
    if (claimed.reason === 'active_payment' || claimed.reason === 'in_progress') {
      return { outcome: 'in_flight' };
    }
    if (claimed.reason === 'changed') return { outcome: 'changed' };
    if (claimed.reason === 'not_connected') {
      throw new SquareAdminError('not_connected', 'That location is not connected to Square.');
    }
    return releaseFailedClaim(db, claims.brand_id, locationId, generation);
  }

  let config: SquareConfig;
  let accessToken: string;
  try {
    config = squareConfigFromEnv();
    accessToken = decryptToken(expected.access_token_encrypted, loadTokenKey());
  } catch {
    return releaseFailedClaim(db, claims.brand_id, locationId, generation);
  }
  if (!await revokeSquareAccessToken(config, accessToken)) {
    return { outcome: 'stranded' };
  }
  const finalized = await finalizeSquareConnectionDisconnect(db, {
    brandId: claims.brand_id, locationId, generation, expected,
  });
  return { outcome: finalized === 'completed' ? 'revoked' : 'stranded' };
}
