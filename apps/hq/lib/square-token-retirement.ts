import { decryptToken, loadTokenKey, revokeOAuthToken, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  SQUARE_ACCESS_TOKEN_RETIREMENT_BATCH_SIZE,
  SQUARE_ACCESS_TOKEN_RETIREMENT_GRACE_MS,
  SQUARE_RENEWAL_RETRY_MS,
} from './square-renewal-contract';

const SQUARE_RENEWAL_CONCURRENCY = 2;

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
