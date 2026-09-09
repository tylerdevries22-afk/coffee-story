import {
  decryptToken,
  encryptToken,
  loadTokenKey,
  revokeOAuthToken,
  type OAuthTokens,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SQUARE_OAUTH_SCOPE_CONTRACT_VERSION } from './square-oauth-contract';
import { queueSquareAccessTokenRetirement } from './square-renewal';

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

/** Replace a connection and durably retire the superseded credential. */
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
    return cleanupNewCredential(config, input.tokens.access_token);
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

  const values = {
    brand_id: input.brandId,
    location_id: input.locationId,
    merchant_id: input.tokens.merchant_id,
    square_location_id: input.squareLocationId,
    access_token_encrypted: encryptToken(input.tokens.access_token, key),
    refresh_token_encrypted: encryptToken(input.tokens.refresh_token, key),
    expires_at: input.tokens.expires_at,
    oauth_scope_contract_version: SQUARE_OAUTH_SCOPE_CONTRACT_VERSION,
  };
  let stored: { data: { id: string } | null; error: { code?: string } | null };
  try {
    stored = input.previousConnection
      ? await db.from('square_connections').update(values)
        .eq('location_id', input.locationId).eq('brand_id', input.brandId)
        .eq('access_token_encrypted', input.previousConnection.access_token_encrypted)
        .eq('refresh_token_encrypted', input.previousConnection.refresh_token_encrypted)
        .select('id').maybeSingle<{ id: string }>()
      : await db.from('square_connections').insert(values)
        .select('id').single<{ id: string }>();
  } catch {
    return cleanupNewCredential(config, input.tokens.access_token);
  }
  if (stored.error || !stored.data?.id) {
    return cleanupNewCredential(config, input.tokens.access_token);
  }

  if (previousAccessToken && previousAccessToken !== input.tokens.access_token) {
    previousRetirementFailed = !await queueSquareAccessTokenRetirement(db, {
      brandId: input.brandId,
      locationId: input.locationId,
      accessTokenEncrypted: input.previousConnection!.access_token_encrypted,
    });
  }
  return { ok: true, connectionId: stored.data.id, previousRetirementFailed };
}

async function cleanupNewCredential(
  config: SquareConfig,
  accessToken: string,
): Promise<SquareConnectionReplacement> {
  return {
    ok: false,
    cleanupFailed: !await revokeSquareAccessToken(config, accessToken),
  };
}
