import type { SupabaseClient } from '@supabase/supabase-js';

import { squareConnectionMutationReason } from './square-connection-mutation';

export type SquareRenewalPersistence =
  | { connectionId: string; connectionGeneration: string }
  | 'refused'
  | 'ambiguous';

/** Persist the exact renewed credential snapshot through the SQL mutation fence. */
export async function finalizeSquareConnectionRenewal(
  db: SupabaseClient,
  input: {
    brandId: string;
    locationId: string;
    mutationGeneration: string;
    expectedConnectionId: string;
    expectedConnectionGeneration: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    expiresAt: string;
  },
): Promise<SquareRenewalPersistence> {
  const args = {
    p_brand_id: input.brandId,
    p_location_id: input.locationId,
    p_mutation_generation: input.mutationGeneration,
    p_expected_connection_id: input.expectedConnectionId,
    p_expected_connection_generation: input.expectedConnectionGeneration,
    p_access_token_encrypted: input.accessTokenEncrypted,
    p_refresh_token_encrypted: input.refreshTokenEncrypted,
    p_expires_at: input.expiresAt,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await db.rpc('finalize_square_connection_renewal', args).single<{
        connection_id: string;
        connection_generation: string;
      }>();
      if (!result.error) {
        return result.data?.connection_id && result.data.connection_generation
          ? {
              connectionId: result.data.connection_id,
              connectionGeneration: result.data.connection_generation,
            }
          : 'ambiguous';
      }
      if (squareConnectionMutationReason(result.error) !== 'unavailable') return 'refused';
    } catch {
      // Exact generation and ciphertext make one response-loss retry safe.
    }
  }
  return 'ambiguous';
}
