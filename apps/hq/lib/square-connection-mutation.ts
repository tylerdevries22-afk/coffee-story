import type { SupabaseClient } from '@supabase/supabase-js';

export type SquareConnectionSnapshot = {
  id: string;
  connection_generation: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
};

export type SquareConnectionMutationReason =
  | 'active_payment' | 'in_progress' | 'changed' | 'not_connected' | 'invalid' | 'unavailable';

type ClaimRow = {
  mutation_generation: string;
  mutation_state: string;
  mutation_claim_created: boolean;
  connection_id: string | null;
  connection_generation: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
};

export type SquareConnectionClaim = {
  generation: string;
  created: boolean;
  connection: SquareConnectionSnapshot | null;
};

export type SquareConnectionClaimResult =
  | { ok: true; claim: SquareConnectionClaim }
  | { ok: false; reason: SquareConnectionMutationReason };

type RpcError = { message?: string } | null;

export function squareConnectionMutationReason(error: RpcError): SquareConnectionMutationReason {
  const message = error?.message ?? '';
  if (message.includes('square_connection_has_active_payment_state')) return 'active_payment';
  if (message.includes('square_connection_transition_in_progress')) return 'in_progress';
  if (message.includes('square_connection_changed')) return 'changed';
  if (message.includes('square_connection_not_connected')) return 'not_connected';
  if (message.includes('square_connection_mutation_invalid')) return 'invalid';
  return 'unavailable';
}

function exactClaim(row: ClaimRow | null, generation: string,
  expected: SquareConnectionSnapshot | null): SquareConnectionClaim | null {
  if (!row || row.mutation_generation !== generation || row.mutation_state !== 'claimed'
    || typeof row.mutation_claim_created !== 'boolean') return null;
  if (!expected) {
    if ([row.connection_id, row.connection_generation, row.access_token_encrypted,
      row.refresh_token_encrypted].some((value) => value !== null)) return null;
    return { generation, created: row.mutation_claim_created, connection: null };
  }
  if (row.connection_id !== expected.id
    || row.connection_generation !== expected.connection_generation
    || row.access_token_encrypted !== expected.access_token_encrypted
    || row.refresh_token_encrypted !== expected.refresh_token_encrypted) return null;
  return { generation, created: row.mutation_claim_created, connection: expected };
}

/** Acquire the database fence before changing any provider authorization. */
export async function claimSquareConnectionMutation(
  db: SupabaseClient,
  input: {
    brandId: string;
    locationId: string;
    generation: string;
    kind: 'disconnect' | 'replace' | 'renew';
    expected: SquareConnectionSnapshot | null;
  },
): Promise<SquareConnectionClaimResult> {
  const args = {
    p_brand_id: input.brandId, p_location_id: input.locationId,
    p_mutation_generation: input.generation, p_mutation_kind: input.kind,
    p_expected_connection_id: input.expected?.id ?? null,
    p_expected_connection_generation: input.expected?.connection_generation ?? null,
    p_expected_access_token_encrypted: input.expected?.access_token_encrypted ?? null,
    p_expected_refresh_token_encrypted: input.expected?.refresh_token_encrypted ?? null,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await db.rpc('claim_square_connection_mutation', args).single<ClaimRow>();
      if (!result.error) {
        const claim = exactClaim(result.data, input.generation, input.expected);
        return claim ? { ok: true, claim } : { ok: false, reason: 'unavailable' };
      }
      const reason = squareConnectionMutationReason(result.error);
      if (reason !== 'unavailable') return { ok: false, reason };
    } catch {
      // The exact generation makes one retry safe after a lost response.
    }
  }
  return { ok: false, reason: 'unavailable' };
}

export async function failSquareConnectionMutation(
  db: SupabaseClient,
  input: { brandId: string; locationId: string; generation: string; code: string },
): Promise<boolean> {
  const args = {
    p_brand_id: input.brandId, p_location_id: input.locationId,
    p_mutation_generation: input.generation, p_error_code: input.code,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await db.rpc('fail_square_connection_mutation', args);
      if (!result.error) return result.data === true;
      if (squareConnectionMutationReason(result.error) !== 'unavailable') return false;
    } catch { /* retry an exact lost response once */ }
  }
  return false;
}

export async function finalizeSquareConnectionDisconnect(
  db: SupabaseClient,
  input: { brandId: string; locationId: string; generation: string; expected: SquareConnectionSnapshot },
): Promise<'completed' | 'refused' | 'ambiguous'> {
  const args = {
    p_brand_id: input.brandId, p_location_id: input.locationId,
    p_mutation_generation: input.generation,
    p_expected_connection_id: input.expected.id,
    p_expected_connection_generation: input.expected.connection_generation,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await db.rpc('finalize_square_connection_disconnect', args);
      if (!result.error) return result.data === true ? 'completed' : 'refused';
      if (squareConnectionMutationReason(result.error) !== 'unavailable') return 'refused';
    } catch { /* retry an exact lost response once */ }
  }
  return 'ambiguous';
}

export async function finalizeSquareConnectionReplacement(
  db: SupabaseClient,
  input: {
    brandId: string;
    locationId: string;
    generation: string;
    expected: SquareConnectionSnapshot | null;
    merchantId: string;
    squareLocationId: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    expiresAt: string;
    scopeContractVersion: number;
  },
): Promise<{ connectionId: string; connectionGeneration: string } | null | 'ambiguous'> {
  const args = {
    p_brand_id: input.brandId, p_location_id: input.locationId,
    p_mutation_generation: input.generation,
    p_expected_connection_id: input.expected?.id ?? null,
    p_expected_connection_generation: input.expected?.connection_generation ?? null,
    p_merchant_id: input.merchantId, p_square_location_id: input.squareLocationId,
    p_access_token_encrypted: input.accessTokenEncrypted,
    p_refresh_token_encrypted: input.refreshTokenEncrypted,
    p_expires_at: input.expiresAt,
    p_oauth_scope_contract_version: input.scopeContractVersion,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await db.rpc('finalize_square_connection_replacement', args).single<{
        connection_id: string; connection_generation: string;
      }>();
      if (!result.error) {
        return result.data?.connection_id && result.data.connection_generation
          ? { connectionId: result.data.connection_id,
            connectionGeneration: result.data.connection_generation } : 'ambiguous';
      }
      if (squareConnectionMutationReason(result.error) !== 'unavailable') return null;
    } catch { /* retry an exact lost response once */ }
  }
  return 'ambiguous';
}
