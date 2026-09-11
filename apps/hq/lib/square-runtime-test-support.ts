import { encryptToken, loadTokenKey } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { squareRuntimeFor, type BrandFeeRow } from './square-runtime';

export const BRAND = '11111111-1111-4111-8111-111111111111';
export const LOCATION = '22222222-2222-4222-8222-222222222222';
export const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
export const DAY = 24 * 60 * 60 * 1000;
const brand: BrandFeeRow = { fee_bps: 250, fee_bps_tier2: 150, tier_threshold_cents: 500_000 };

export type ConnectionRow = {
  id: string;
  connection_generation: string;
  square_location_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  updated_at: string | null;
  oauth_scope_contract_version: number;
};

type RpcResult = { data: Record<string, unknown> | null; error: { message: string } | null };
export type RpcCall = { name: string; args: Record<string, unknown> };

export type DbState = {
  connection: ConnectionRow | null;
  rpcCalls: RpcCall[];
  retirementWrites?: Record<string, unknown>[];
  rpcResults?: RpcResult[];
};

function runtimeDb(state: DbState): SupabaseClient {
  const location = {
    select: () => location, eq: () => location,
    maybeSingle: async () => ({
      data: { id: LOCATION, timezone: 'America/Denver', fee_bps: null,
        fee_bps_tier2: null, tier_threshold_cents: null },
      error: null,
    }),
  };
  const connection = {
    select: () => connection,
    eq: () => connection,
    gte: () => connection,
    maybeSingle: async () => ({ data: state.connection, error: null }),
  };
  const retirement = {
    insert: (values: Record<string, unknown>) => {
      state.retirementWrites?.push(values);
      return retirement;
    },
    select: () => retirement,
    maybeSingle: async () => ({ data: { id: 'retirement' }, error: null }),
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    state.rpcCalls.push({ name, args });
    const single = async () => {
      const queued = state.rpcResults?.shift();
      if (queued?.data === null) return {
        data: null,
        error: queued.error ?? { message: 'square_connection_changed' },
      };
      if (name === 'claim_square_connection_mutation') {
        const row = state.connection;
        return { data: row ? {
          mutation_generation: args.p_mutation_generation,
          mutation_state: 'claimed',
          mutation_claim_created: true,
          connection_id: row.id,
          connection_generation: row.connection_generation,
          access_token_encrypted: row.access_token_encrypted,
          refresh_token_encrypted: row.refresh_token_encrypted,
        } : null, error: null };
      }
      return { data: {
        connection_id: state.connection?.id,
        connection_generation: '66666666-6666-4666-8666-666666666666',
      }, error: null };
    };
    return { single, data: true, error: null };
  };
  return {
    from: (table: string) => table === 'locations' ? location
      : table === 'square_access_token_retirements' ? retirement : connection,
    rpc,
  } as unknown as SupabaseClient;
}

export const at = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
export const squareTestState = { realFetch: globalThis.fetch, refreshCalls: 0 };

export function stubSquare(response: { ok: boolean; body?: unknown }): void {
  squareTestState.refreshCalls = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/oauth2/revoke')) return new Response('{"success":true}', { status: 200 });
    squareTestState.refreshCalls += 1;
    if (!response.ok) throw new Error('Square is unreachable');
    return new Response(JSON.stringify(response.body ?? {}), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
}

export function connectionRow(over: Partial<ConnectionRow> = {}): ConnectionRow {
  const key = loadTokenKey();
  return {
    id: '44444444-4444-4444-8444-444444444444',
    connection_generation: '55555555-5555-4555-8555-555555555555',
    square_location_id: 'SQ-LOC',
    access_token_encrypted: encryptToken('stored-access', key),
    refresh_token_encrypted: encryptToken('stored-refresh', key),
    expires_at: at(60 * DAY), updated_at: at(-DAY), oauth_scope_contract_version: 2,
    ...over,
  };
}

export const resolve = (state: DbState) =>
  squareRuntimeFor(runtimeDb(state), { brandId: BRAND, locationId: LOCATION, brand });
