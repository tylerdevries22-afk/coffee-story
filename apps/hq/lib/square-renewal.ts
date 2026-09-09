import { randomUUID } from 'node:crypto';

import {
  decryptToken,
  encryptToken,
  loadTokenKey,
  refreshOAuthToken,
  revokeOAuthToken,
  SQUARE_REFRESH_MARGIN_MS,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  SQUARE_RENEWAL_BATCH_SIZE,
  SQUARE_RENEWAL_RETRY_MS,
  type SquareRenewalConnection,
  type SquareRenewalResult,
  type SquareRenewalSummary,
} from './square-renewal-contract';
import {
  claimSquareConnectionMutation,
  failSquareConnectionMutation,
} from './square-connection-mutation';
import { finalizeSquareConnectionRenewal } from './square-renewal-persistence';
import { queueSquareAccessTokenRetirement } from './square-token-retirement';

export * from './square-renewal-contract';
export * from './square-token-retirement';

const SQUARE_RENEWAL_CONCURRENCY = 2;

async function revokeIssuedAccess(square: SquareConfig, token: string): Promise<boolean> {
  if (!token.trim()) return true;
  try {
    await revokeOAuthToken(square, token, { revokeOnlyAccessToken: true });
    return true;
  } catch {
    return false;
  }
}

/** Renew exactly the authorization snapshot read by the caller. */
export async function renewSquareConnection(
  db: SupabaseClient,
  square: SquareConfig,
  input: SquareRenewalConnection,
  nowMs: number = Date.now(),
): Promise<SquareRenewalResult> {
  const mutationGeneration = randomUUID();
  const claimed = await claimSquareConnectionMutation(db, {
    brandId: input.brand_id,
    locationId: input.location_id,
    generation: mutationGeneration,
    kind: 'renew',
    expected: input,
  });
  if (!claimed.ok) {
    return { outcome: 'stale', stage: 'claim', cleanupFailed: false };
  }

  let previousAccessToken: string;
  let previousRefreshToken: string;
  let key: ReturnType<typeof loadTokenKey>;
  try {
    key = loadTokenKey();
    previousAccessToken = decryptToken(input.access_token_encrypted, key);
    previousRefreshToken = decryptToken(input.refresh_token_encrypted, key);
  } catch {
    await failSquareConnectionMutation(db, {
      brandId: input.brand_id,
      locationId: input.location_id,
      generation: mutationGeneration,
      code: 'renewal_pre_provider_failure',
    });
    return { outcome: 'failed', cleanupFailed: false };
  }

  let tokens: Awaited<ReturnType<typeof refreshOAuthToken>>;
  try {
    tokens = await refreshOAuthToken(square, previousRefreshToken);
  } catch {
    // Delivery may have reached Square, so keep the mutation fence for review.
    return { outcome: 'failed', cleanupFailed: false };
  }
  const cleanupIssued = (token: string): Promise<boolean> => token === previousAccessToken
    ? Promise.resolve(true)
    : revokeIssuedAccess(square, token);
  const expiry = Date.parse(tokens.expires_at);
  if (!tokens.access_token?.trim() || !Number.isFinite(expiry) || expiry <= nowMs) {
    const cleaned = tokens.access_token ? await cleanupIssued(tokens.access_token) : true;
    return { outcome: 'failed', cleanupFailed: !cleaned };
  }

  let accessTokenEncrypted: string;
  let refreshTokenEncrypted: string;
  try {
    accessTokenEncrypted = encryptToken(tokens.access_token, key);
    refreshTokenEncrypted = tokens.refresh_token?.trim()
      ? encryptToken(tokens.refresh_token, key)
      : input.refresh_token_encrypted;
  } catch {
    return { outcome: 'failed', cleanupFailed: !await cleanupIssued(tokens.access_token) };
  }

  const persisted = await finalizeSquareConnectionRenewal(db, {
    brandId: input.brand_id,
    locationId: input.location_id,
    mutationGeneration,
    expectedConnectionId: input.id,
    expectedConnectionGeneration: input.connection_generation,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    expiresAt: tokens.expires_at,
  });
  if (persisted === 'ambiguous' || (persisted !== 'refused' && persisted.connectionId !== input.id)) {
    return { outcome: 'stale', stage: 'persist', cleanupFailed: true };
  }
  if (persisted === 'refused') {
    return {
      outcome: 'stale',
      stage: 'persist',
      cleanupFailed: !await cleanupIssued(tokens.access_token),
    };
  }
  const cleanupFailed = tokens.access_token === previousAccessToken
    ? false
    : !await queueSquareAccessTokenRetirement(db, {
      brandId: input.brand_id,
      locationId: input.location_id,
      accessTokenEncrypted: input.access_token_encrypted,
      nowMs,
    });
  return {
    outcome: 'renewed',
    accessToken: tokens.access_token,
    connectionGeneration: persisted.connectionGeneration,
    cleanupFailed,
  };
}

/** Renew a bounded set of inactive as well as active Square connections. */
export async function renewDueSquareConnections(
  db: SupabaseClient,
  square: SquareConfig,
  now: Date,
): Promise<SquareRenewalSummary> {
  const retryBefore = new Date(now.getTime() - SQUARE_RENEWAL_RETRY_MS).toISOString();
  const dueBefore = new Date(now.getTime() + SQUARE_REFRESH_MARGIN_MS).toISOString();
  let due: { data: SquareRenewalConnection[] | null; error: { message?: string } | null };
  try {
    due = await db
      .from('square_connections')
      .select('id, connection_generation, brand_id, location_id, access_token_encrypted, refresh_token_encrypted, expires_at, updated_at')
      .not('refresh_token_encrypted', 'is', null)
      .lte('updated_at', retryBefore)
      .or(`expires_at.is.null,expires_at.lte.${dueBefore}`)
      .order('updated_at', { ascending: true })
      .limit(SQUARE_RENEWAL_BATCH_SIZE)
      .returns<SquareRenewalConnection[]>();
  } catch (error) {
    console.error('Square token renewal scan failed.', {
      error: error instanceof Error ? error.message : 'database query failed',
    });
    return { scanned: 0, renewed: 0, failed: 0, stale: 0, scanFailed: true, cleanupFailed: 0 };
  }
  if (due.error) {
    console.error('Square token renewal scan failed.', {
      error: due.error.message ?? 'database query failed',
    });
    return { scanned: 0, renewed: 0, failed: 0, stale: 0, scanFailed: true, cleanupFailed: 0 };
  }

  const summary: SquareRenewalSummary = {
    scanned: due.data?.length ?? 0,
    renewed: 0,
    failed: 0,
    stale: 0,
    scanFailed: false,
    cleanupFailed: 0,
  };
  const rows = due.data ?? [];
  for (let offset = 0; offset < rows.length; offset += SQUARE_RENEWAL_CONCURRENCY) {
    const results = await Promise.all(rows.slice(offset, offset + SQUARE_RENEWAL_CONCURRENCY)
      .map((row) => renewSquareConnection(db, square, row, now.getTime())));
    for (const result of results) {
      summary[result.outcome] += 1;
      if (result.cleanupFailed) summary.cleanupFailed += 1;
    }
  }
  return summary;
}
