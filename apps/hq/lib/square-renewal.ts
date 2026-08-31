import {
  decryptToken,
  encryptToken,
  loadTokenKey,
  refreshOAuthToken,
  SQUARE_REFRESH_MARGIN_MS,
  type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

export const SQUARE_RENEWAL_RETRY_MS = 15 * 60 * 1_000;
export const SQUARE_RENEWAL_BATCH_SIZE = 10;
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
  | { outcome: 'renewed'; accessToken: string }
  | { outcome: 'failed' }
  | { outcome: 'stale' };

export type SquareRenewalSummary = {
  scanned: number;
  renewed: number;
  failed: number;
  stale: number;
};

export function squareRenewalBackoffActive(updatedAt: string | null | undefined, nowMs: number): boolean {
  if (!updatedAt) return false;
  const lastAttempt = Date.parse(updatedAt);
  return Number.isFinite(lastAttempt) && nowMs - lastAttempt < SQUARE_RENEWAL_RETRY_MS;
}

async function recordFailedAttempt(
  db: SupabaseClient,
  input: SquareRenewalConnection,
): Promise<'failed' | 'stale'> {
  try {
    // A no-op update deliberately fires square_connections_touch. `updated_at`
    // is the retry clock shared by checkout traffic and the scheduled job, so
    // a provider outage cannot make either path hammer Square every request.
    const recorded = await db
      .from('square_connections')
      .update({ expires_at: input.expires_at })
      .eq('location_id', input.location_id)
      .eq('brand_id', input.brand_id)
      .eq('access_token_encrypted', input.access_token_encrypted)
      .eq('refresh_token_encrypted', input.refresh_token_encrypted)
      .select('location_id')
      .maybeSingle<{ location_id: string }>();
    return !recorded.error && !recorded.data ? 'stale' : 'failed';
  } catch {
    return 'failed';
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
  let accessToken: string;
  let update: Record<string, string>;
  try {
    const key = loadTokenKey();
    const tokens = await refreshOAuthToken(square, decryptToken(input.refresh_token_encrypted, key));
    const expiry = Date.parse(tokens.expires_at);
    if (!tokens.access_token?.trim() || !Number.isFinite(expiry) || expiry <= nowMs) {
      return { outcome: await recordFailedAttempt(db, input) };
    }
    accessToken = tokens.access_token;
    update = {
      access_token_encrypted: encryptToken(tokens.access_token, key),
      ...(tokens.refresh_token?.trim()
        ? { refresh_token_encrypted: encryptToken(tokens.refresh_token, key) }
        : {}),
      expires_at: tokens.expires_at,
    };
  } catch {
    return { outcome: await recordFailedAttempt(db, input) };
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
    return !persisted.error && persisted.data?.location_id === input.location_id
      ? { outcome: 'renewed', accessToken }
      : { outcome: 'stale' };
  } catch {
    return { outcome: 'stale' };
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
  const due = await db
    .from('square_connections')
    .select('brand_id, location_id, access_token_encrypted, refresh_token_encrypted, expires_at, updated_at')
    .not('refresh_token_encrypted', 'is', null)
    .lte('updated_at', retryBefore)
    .or(`expires_at.is.null,expires_at.lte.${dueBefore}`)
    .order('updated_at', { ascending: true })
    .limit(SQUARE_RENEWAL_BATCH_SIZE)
    .returns<SquareRenewalConnection[]>();
  if (due.error) throw due.error;

  const summary: SquareRenewalSummary = {
    scanned: due.data?.length ?? 0,
    renewed: 0,
    failed: 0,
    stale: 0,
  };
  const rows = due.data ?? [];
  for (let offset = 0; offset < rows.length; offset += SQUARE_RENEWAL_CONCURRENCY) {
    const results = await Promise.all(
      rows.slice(offset, offset + SQUARE_RENEWAL_CONCURRENCY)
        .map((row) => renewSquareConnection(db, square, row, now.getTime())),
    );
    for (const result of results) summary[result.outcome] += 1;
  }
  return summary;
}
