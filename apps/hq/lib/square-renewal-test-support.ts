import { encryptToken, loadTokenKey, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { SquareRenewalConnection } from './square-renewal';

export const BRAND = '11111111-1111-4111-8111-111111111111';
export const TOKEN_KEY = Buffer.alloc(32, 9).toString('base64');
export const NOW = new Date('2026-08-31T06:00:00.000Z');
export const DAY = 24 * 60 * 60 * 1_000;
export const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret', apiBase: 'https://square.test',
};

export type UpdateRecord = {
  values: Record<string, unknown>;
  filters: Record<string, unknown>;
};

export type RpcCall = { name: string; args: Record<string, unknown> };

export function renewalRow(locationId: string): SquareRenewalConnection {
  const key = loadTokenKey();
  return {
    id: `44444444-4444-4444-8444-${locationId.slice(-12)}`,
    connection_generation: `55555555-5555-4555-8555-${locationId.slice(-12)}`,
    brand_id: BRAND,
    location_id: locationId,
    access_token_encrypted: encryptToken(`access-${locationId}`, key),
    refresh_token_encrypted: encryptToken(`refresh-${locationId}`, key),
    expires_at: new Date(NOW.getTime() + DAY).toISOString(),
    updated_at: new Date(NOW.getTime() - DAY).toISOString(),
  };
}

export function renewalDb(
  rows: SquareRenewalConnection[],
  calls: RpcCall[],
  options: {
    liveClaims?: Set<string>;
    lostClaimResponses?: Set<string>;
    staleClaims?: Set<string>;
    stalePersists?: Set<string>;
    lostFinalizeResponses?: Set<string>;
    queryError?: { message: string };
    retirementWrites?: Record<string, unknown>[];
    retirementError?: { code?: string };
  } = {},
): SupabaseClient {
  const query = {
    select: () => query,
    not: () => query,
    lte: () => query,
    or: () => query,
    order: () => query,
    limit: () => query,
    returns: async () => ({ data: rows, error: options.queryError ?? null }),
  };
  const retirement = {
    insert: (values: Record<string, unknown>) => {
      options.retirementWrites?.push(values);
      return retirement;
    },
    select: () => retirement,
    maybeSingle: async () => ({
      data: options.retirementError ? null : { id: 'retirement' },
      error: options.retirementError ?? null,
    }),
  };
  const lost = new Set(options.lostFinalizeResponses);
  const lostClaims = new Set(options.lostClaimResponses);
  const rpc = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    const locationId = String(args.p_location_id);
    const single = async () => {
      if (name === 'claim_square_connection_mutation') {
        if (lostClaims.delete(locationId)) throw new TypeError('response lost');
        if (options.staleClaims?.has(locationId)) {
          return { data: null, error: { message: 'square_connection_changed' } };
        }
        const expected = rows.find((row) => row.location_id === locationId) ?? renewalRow(locationId);
        return { data: {
          mutation_generation: args.p_mutation_generation,
          mutation_state: 'claimed',
          mutation_claim_created: !options.liveClaims?.has(locationId),
          connection_id: expected.id,
          connection_generation: expected.connection_generation,
          access_token_encrypted: expected.access_token_encrypted,
          refresh_token_encrypted: expected.refresh_token_encrypted,
        }, error: null };
      }
      if (name === 'finalize_square_connection_renewal') {
        if (lost.delete(locationId)) throw new TypeError('response lost');
        if (options.stalePersists?.has(locationId)) {
          return { data: null, error: { message: 'square_connection_changed' } };
        }
        return { data: {
          connection_id: args.p_expected_connection_id,
          connection_generation: '66666666-6666-4666-8666-666666666666',
        }, error: null };
      }
      return { data: true, error: null };
    };
    return { single, data: true, error: null };
  };
  return {
    from: (tableName: string) => tableName === 'square_access_token_retirements' ? retirement : query,
    rpc,
  } as unknown as SupabaseClient;
}
