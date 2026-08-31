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

export const SQUARE_RENEWAL_RETRY_MS = 15 * 60 * 1_000;
export const SQUARE_RENEWAL_BATCH_SIZE = 10;
// One scheduled interval is long enough for a checkout or refund request that
// already resolved the old runtime to finish. The outgoing token is never used
// for new work after the connection row changes.
export const SQUARE_ACCESS_TOKEN_RETIREMENT_GRACE_MS = 5 * 60 * 1_000;
export const SQUARE_ACCESS_TOKEN_RETIREMENT_BATCH_SIZE = 10;
const SQUARE_RENEWAL_CONCURRENCY = 2;

export type SquareRenewalConnection = {
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string | null;
  updated_at: string | null;
};

export type SquareRenewalResult =
  | { outcome: 'renewed'; accessToken: string; cleanupFailed: boolean }
  | { outcome: 'failed'; cleanupFailed: boolean }
  | { outcome: 'stale'; stage: 'claim' | 'persist'; cleanupFailed: boolean };

export type SquareRenewalSummary = {
  scanned: number;
  renewed: number;
  failed: number;
  stale: number;
  scanFailed: boolean;
  cleanupFailed: number;
};

type SquareAccessTokenRetirement = {
  id: string;
  brand_id: string;
  location_id: string;
  access_token_encrypted: string;
  retire_after: string;
};

export type SquareAccessTokenRetirementSummary = {
  scanned: number;
  retired: number;
  failed: number;
  stale: number;
  scanFailed: boolean;
};

/**
 * Retire an outgoing credential after in-flight Square calls have finished.
 *
 * The queue holds only AES-GCM ciphertext and has no client policy. Keeping a
 * durable row is important: a serverless callback cannot safely use a timer,
 * and deleting the source location must not discard the sole revocation handle.
 */
export async function queueSquareAccessTokenRetirement(
  db: SupabaseClient,
  input: { brandId: string; locationId: string; accessTokenEncrypted: string; nowMs?: number },
): Promise<boolean> {
  try {
    const queued = await db
      .from('square_access_token_retirements')
      .insert({
        brand_id: input.brandId,
        location_id: input.locationId,
        access_token_encrypted: input.accessTokenEncrypted,
        retire_after: new Date((input.nowMs ?? Date.now()) + SQUARE_ACCESS_TOKEN_RETIREMENT_GRACE_MS).toISOString(),
      })
      .select('id')
      .maybeSingle<{ id: string }>();
    // The exact ciphertext can only be queued once. A duplicate means a prior
    // worker already owns its eventual revocation, so it is not a cleanup loss.
    return (!queued.error && Boolean(queued.data?.id)) || queued.error?.code === '23505';
  } catch {
    return false;
  }
}

async function claimSquareAccessTokenRetirement(
  db: SupabaseClient,
  row: SquareAccessTokenRetirement,
  nowMs: number,
): Promise<boolean> {
  try {
    const claimed = await db
      .from('square_access_token_retirements')
      .update({ retire_after: new Date(nowMs + SQUARE_RENEWAL_RETRY_MS).toISOString() })
      .eq('id', row.id)
      .eq('brand_id', row.brand_id)
      .eq('location_id', row.location_id)
      .eq('access_token_encrypted', row.access_token_encrypted)
      .eq('retire_after', row.retire_after)
      .select('id')
      .maybeSingle<{ id: string }>();
    return !claimed.error && claimed.data?.id === row.id;
  } catch {
    return false;
  }
}

async function retireSquareAccessToken(
  db: SupabaseClient,
  square: SquareConfig,
  row: SquareAccessTokenRetirement,
  nowMs: number,
): Promise<'retired' | 'failed' | 'stale'> {
  if (!await claimSquareAccessTokenRetirement(db, row, nowMs)) return 'stale';

  try {
      await revokeOAuthToken(square, decryptToken(row.access_token_encrypted, loadTokenKey()), {
        revokeOnlyAccessToken: true,
      });
  } catch {
    return 'failed';
  }

  try {
    const removed = await db
      .from('square_access_token_retirements')
      .delete()
      .eq('id', row.id)
      .eq('brand_id', row.brand_id)
      .eq('location_id', row.location_id)
      .eq('access_token_encrypted', row.access_token_encrypted)
      .select('id')
      .maybeSingle<{ id: string }>();
    return !removed.error && removed.data?.id === row.id ? 'retired' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Process a bounded batch of credentials whose grace period has elapsed. */
export async function retireDueSquareAccessTokens(
  db: SupabaseClient,
  square: SquareConfig,
  now: Date,
): Promise<SquareAccessTokenRetirementSummary> {
  let due: { data: SquareAccessTokenRetirement[] | null; error: { message?: string } | null };
  try {
    due = await db
      .from('square_access_token_retirements')
      .select('id, brand_id, location_id, access_token_encrypted, retire_after')
      .lte('retire_after', now.toISOString())
      .order('retire_after', { ascending: true })
      .limit(SQUARE_ACCESS_TOKEN_RETIREMENT_BATCH_SIZE)
      .returns<SquareAccessTokenRetirement[]>();
  } catch (error) {
    console.error('Square access-token retirement scan failed.', {
      error: error instanceof Error ? error.message : 'database query failed',
    });
    return { scanned: 0, retired: 0, failed: 0, stale: 0, scanFailed: true };
  }
  if (due.error) {
    console.error('Square access-token retirement scan failed.', {
      error: due.error.message ?? 'database query failed',
    });
    return { scanned: 0, retired: 0, failed: 0, stale: 0, scanFailed: true };
  }

  const summary: SquareAccessTokenRetirementSummary = {
    scanned: due.data?.length ?? 0,
    retired: 0,
    failed: 0,
    stale: 0,
    scanFailed: false,
  };
  const rows = due.data ?? [];
  for (let offset = 0; offset < rows.length; offset += SQUARE_RENEWAL_CONCURRENCY) {
    const results = await Promise.all(rows.slice(offset, offset + SQUARE_RENEWAL_CONCURRENCY)
      .map((row) => retireSquareAccessToken(db, square, row, now.getTime())));
    for (const result of results) summary[result] += 1;
  }
  return summary;
}

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
