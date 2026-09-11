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
import { queueSquareAccessTokenRetirement } from './square-token-retirement';
const SQUARE_RENEWAL_CONCURRENCY = 2;
export function squareRenewalBackoffActive(updatedAt: string | null | undefined, nowMs: number): boolean {
  if (!updatedAt) return false;
  const lastAttempt = Date.parse(updatedAt);
  return Number.isFinite(lastAttempt) && nowMs - lastAttempt < SQUARE_RENEWAL_RETRY_MS;
}

async function claimRenewalAttempt(
  db: SupabaseClient,
  input: SquareRenewalConnection,
): Promise<boolean> {
  try {
    // This compare-and-set claim happens before the provider call. The no-op
    // update fires square_connections_touch, making updated_at both a short
    // lease and the retry clock shared by checkout traffic and the scheduled
    // job. Two overlapping cron ticks therefore cannot trade the same token.
    let claim = db
      .from('square_connections')
      .update({ expires_at: input.expires_at })
      .eq('location_id', input.location_id)
      .eq('brand_id', input.brand_id)
      .eq('access_token_encrypted', input.access_token_encrypted)
      .eq('refresh_token_encrypted', input.refresh_token_encrypted);
    claim = input.updated_at
      ? claim.eq('updated_at', input.updated_at)
      : claim.is('updated_at', null);
    const recorded = await claim
      .select('location_id')
      .maybeSingle<{ location_id: string }>();
    return !recorded.error && recorded.data?.location_id === input.location_id;
  } catch {
    return false;
  }
}

/**
 * Renews exactly the authorization snapshot that was read by the caller.
 *
 * Both encrypted tokens participate in the compare-and-set. Square can leave
 * the refresh token unchanged, so checking only that token allows concurrent
 * renewals to overwrite one another or a reconnect to receive stale tokens.
 */
export async function renewSquareConnection(
  db: SupabaseClient,
  square: SquareConfig,
  input: SquareRenewalConnection,
  nowMs: number = Date.now(),
): Promise<SquareRenewalResult> {
  if (!await claimRenewalAttempt(db, input)) {
    return { outcome: 'stale', stage: 'claim', cleanupFailed: false };
  }

  let previousAccessToken: string;
  let accessToken: string;
  let update: Record<string, string>;
  let tokens: Awaited<ReturnType<typeof refreshOAuthToken>>;
  let key: ReturnType<typeof loadTokenKey>;
  try {
    key = loadTokenKey();
    previousAccessToken = decryptToken(input.access_token_encrypted, key);
    tokens = await refreshOAuthToken(square, decryptToken(input.refresh_token_encrypted, key));
  } catch {
    return { outcome: 'failed', cleanupFailed: false };
  }

  const revoke = async (token: string): Promise<boolean> => {
    if (!token.trim()) return true;
    try {
      await revokeOAuthToken(square, token, { revokeOnlyAccessToken: true });
      return true;
    } catch {
      return false;
    }
  };
  const cleanupIssued = (token: string): Promise<boolean> => token === previousAccessToken
    ? Promise.resolve(true)
    : revoke(token);

  const expiry = Date.parse(tokens.expires_at);
  if (!tokens.access_token?.trim() || !Number.isFinite(expiry) || expiry <= nowMs) {
    const cleaned = tokens.access_token ? await cleanupIssued(tokens.access_token) : true;
    return { outcome: 'failed', cleanupFailed: !cleaned };
  }
  try {
    accessToken = tokens.access_token;
    update = {
      access_token_encrypted: encryptToken(tokens.access_token, key),
      ...(tokens.refresh_token?.trim()
        ? { refresh_token_encrypted: encryptToken(tokens.refresh_token, key) }
        : {}),
      expires_at: tokens.expires_at,
    };
  } catch {
    return { outcome: 'failed', cleanupFailed: !await cleanupIssued(tokens.access_token) };
  }

  try {
    const persisted = await db
      .from('square_connections')
      .update(update)
      .eq('location_id', input.location_id)
      .eq('brand_id', input.brand_id)
      .eq('access_token_encrypted', input.access_token_encrypted)
      .eq('refresh_token_encrypted', input.refresh_token_encrypted)
      .select('location_id')
      .maybeSingle<{ location_id: string }>();
    if (!persisted.error && persisted.data?.location_id === input.location_id) {
      return {
        outcome: 'renewed',
        accessToken,
        cleanupFailed: accessToken === previousAccessToken
          ? false
          : !await queueSquareAccessTokenRetirement(db, {
            brandId: input.brand_id,
            locationId: input.location_id,
            accessTokenEncrypted: input.access_token_encrypted,
            nowMs,
          }),
      };
    }
    return { outcome: 'stale', stage: 'persist', cleanupFailed: !await cleanupIssued(accessToken) };
  } catch {
    return { outcome: 'stale', stage: 'persist', cleanupFailed: !await cleanupIssued(accessToken) };
  }
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
      .select('brand_id, location_id, access_token_encrypted, refresh_token_encrypted, expires_at, updated_at')
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
    const results = await Promise.all(
      rows.slice(offset, offset + SQUARE_RENEWAL_CONCURRENCY)
        .map((row) => renewSquareConnection(db, square, row, now.getTime())),
    );
    for (const result of results) {
      summary[result.outcome] += 1;
      if (result.cleanupFailed) summary.cleanupFailed += 1;
    }
  }
  return summary;
}

export * from './square-renewal-contract';
export { queueSquareAccessTokenRetirement, retireDueSquareAccessTokens } from './square-token-retirement';
