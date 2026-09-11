import { randomUUID } from 'node:crypto';

import {
  decryptToken,
  encryptToken,
  loadTokenKey,
  revokeOAuthToken,
  type OAuthTokens,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  claimSquareConnectionMutation,
  failSquareConnectionMutation,
  finalizeSquareConnectionReplacement,
  type SquareConnectionSnapshot,
} from './square-connection-mutation';
import { SQUARE_OAUTH_SCOPE_CONTRACT_VERSION } from './square-oauth-contract';
import { queueSquareAccessTokenRetirement } from './square-renewal';

export type SquareConnectionReplacement =
  | { ok: true; connectionId: string; connectionGeneration: string;
    previousRetirementFailed: boolean }
  | { ok: false; reason: 'in_flight' | 'connection_changed' | 'storage_failed'
    | 'storage_ambiguous'; cleanupFailed: boolean };

type ReplacementFailureReason = Extract<SquareConnectionReplacement, { ok: false }>['reason'];

/** Revoke a full grant for disconnect, or one access token for compensation. */
export async function revokeSquareAccessToken(
  config: SquareConfig,
  accessToken: string,
  revokeOnlyAccessToken = false,
): Promise<boolean> {
  try {
    const response = await revokeOAuthToken(config, accessToken, { revokeOnlyAccessToken });
    return Boolean(response && typeof response === 'object'
      && (response as { success?: unknown }).success === true);
  } catch {
    return false;
  }
}

async function refuseIssuedGrant(
  db: SupabaseClient,
  config: SquareConfig,
  input: { brandId: string; locationId: string; generation?: string;
    accessToken: string; reason: ReplacementFailureReason },
): Promise<SquareConnectionReplacement> {
  if (input.generation) {
    await failSquareConnectionMutation(db, {
      brandId: input.brandId, locationId: input.locationId,
      generation: input.generation, code: 'replacement_not_applied',
    });
  }
  return {
    ok: false,
    reason: input.reason,
    cleanupFailed: !await revokeSquareAccessToken(config, input.accessToken, true),
  };
}

/** Atomically replace a connection, then queue the superseded access token. */
export async function replaceSquareConnection(
  db: SupabaseClient,
  config: SquareConfig,
  input: {
    brandId: string;
    locationId: string;
    squareLocationId: string;
    tokens: OAuthTokens;
    previousConnection: SquareConnectionSnapshot | null;
  },
): Promise<SquareConnectionReplacement> {
  let key: ReturnType<typeof loadTokenKey>;
  let accessTokenEncrypted: string;
  let refreshTokenEncrypted: string;
  try {
    key = loadTokenKey();
    accessTokenEncrypted = encryptToken(input.tokens.access_token, key);
    refreshTokenEncrypted = encryptToken(input.tokens.refresh_token, key);
  } catch {
    return refuseIssuedGrant(db, config, { ...input, accessToken: input.tokens.access_token,
      reason: 'storage_failed' });
  }

  const generation = randomUUID();
  const claimed = await claimSquareConnectionMutation(db, {
    brandId: input.brandId, locationId: input.locationId, generation,
    kind: 'replace', expected: input.previousConnection,
  });
  if (!claimed.ok) {
    const reason = claimed.reason === 'active_payment' || claimed.reason === 'in_progress'
      ? 'in_flight' : claimed.reason === 'changed' ? 'connection_changed' : 'storage_failed';
    return refuseIssuedGrant(db, config, { ...input, generation,
      accessToken: input.tokens.access_token, reason });
  }

  const stored = await finalizeSquareConnectionReplacement(db, {
    brandId: input.brandId, locationId: input.locationId, generation,
    expected: input.previousConnection, merchantId: input.tokens.merchant_id,
    squareLocationId: input.squareLocationId, accessTokenEncrypted,
    refreshTokenEncrypted, expiresAt: input.tokens.expires_at,
    scopeContractVersion: SQUARE_OAUTH_SCOPE_CONTRACT_VERSION,
  });
  if (stored === 'ambiguous') {
    return { ok: false, reason: 'storage_ambiguous', cleanupFailed: true };
  }
  if (!stored) {
    return refuseIssuedGrant(db, config, { ...input, generation,
      accessToken: input.tokens.access_token, reason: 'storage_failed' });
  }

  let previousRetirementFailed = false;
  if (input.previousConnection) {
    try {
      const oldAccess = decryptToken(input.previousConnection.access_token_encrypted, key);
      if (oldAccess !== input.tokens.access_token) {
        previousRetirementFailed = !await queueSquareAccessTokenRetirement(db, {
          brandId: input.brandId, locationId: input.locationId,
          accessTokenEncrypted: input.previousConnection.access_token_encrypted,
        });
      }
    } catch { previousRetirementFailed = true; }
  }
  return { ok: true, ...stored, previousRetirementFailed };
}
