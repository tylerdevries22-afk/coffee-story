import type { TestContext } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, loadTokenKey, type OAuthTokens, type SquareConfig } from '@platform/engine';
import type { TenantClaims } from '@platform/schema';

import type { SquareConnectionSnapshot } from './square-connection-mutation';

export const BRAND = '11111111-1111-4111-8111-111111111111';
export const LOCATION = '22222222-2222-4222-8222-222222222222';
export const OTHER_LOCATION = '33333333-3333-4333-8333-333333333333';
export const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
export const owner: TenantClaims = {
  brand_id: BRAND, location_ids: [LOCATION], role: 'brand_owner',
};
export const guest: TenantClaims = { brand_id: BRAND, location_ids: [] };
export const manager: TenantClaims = {
  brand_id: BRAND, location_ids: [LOCATION], role: 'location_manager',
};
export const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
  apiBase: 'https://square.test',
};
export const tokens: OAuthTokens = {
  access_token: 'new-access', refresh_token: 'new-refresh', merchant_id: 'merchant',
  expires_at: '2026-10-08T00:00:00.000Z',
};

export type RpcCall = { name: string; args: Record<string, unknown> };
export type DbHarness = {
  db: SupabaseClient;
  calls: RpcCall[];
  writes: Record<string, unknown>[];
  filters: Record<string, unknown>[];
};

export function snapshot(over: Partial<SquareConnectionSnapshot> = {}): SquareConnectionSnapshot {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    connection_generation: '55555555-5555-4555-8555-555555555555',
    access_token_encrypted: encryptToken('old-access', loadTokenKey()),
    refresh_token_encrypted: encryptToken('old-refresh', loadTokenKey()),
    ...over,
  };
}

type RpcResult = { data: unknown; error: { message?: string } | null };

export function successfulMutationClaim(
  call: RpcCall, connection: SquareConnectionSnapshot | null,
): RpcResult {
  return { data: {
    mutation_generation: call.args.p_mutation_generation, mutation_state: 'claimed',
    mutation_claim_created: true,
    connection_id: connection?.id ?? null,
    connection_generation: connection?.connection_generation ?? null,
    access_token_encrypted: connection?.access_token_encrypted ?? null,
    refresh_token_encrypted: connection?.refresh_token_encrypted ?? null,
  }, error: null };
}

export function adminHarness(options: {
  connection?: SquareConnectionSnapshot | null;
  rpc?: (call: RpcCall) => RpcResult | Promise<RpcResult>;
  retirementOk?: boolean;
  pointerOk?: boolean;
} = {}): DbHarness {
  const calls: RpcCall[] = [];
  const writes: Record<string, unknown>[] = [];
  const filters: Record<string, unknown>[] = [];
  const connection = options.connection === undefined ? snapshot() : options.connection;
  const response = async (call: RpcCall): Promise<RpcResult> => {
    if (options.rpc) return options.rpc(call);
    if (call.name === 'claim_square_connection_mutation') {
      return successfulMutationClaim(call, connection);
    }
    if (call.name === 'finalize_square_connection_replacement') return { data: {
      connection_id: '66666666-6666-4666-8666-666666666666',
      connection_generation: '77777777-7777-4777-8777-777777777777',
    }, error: null };
    return { data: true, error: null };
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    const call = { name, args }; calls.push(call);
    const promise = response(call);
    return Object.assign(promise, { single: () => promise });
  };
  const connectionQuery = {
    select: () => connectionQuery,
    eq: (column: string, value: unknown) => { filters.push({ [column]: value }); return connectionQuery; },
    maybeSingle: async () => ({ data: connection, error: null }),
  };
  const retirement = {
    insert: (value: Record<string, unknown>) => { writes.push(value); return retirement; },
    select: () => retirement,
    maybeSingle: async () => options.retirementOk === false
      ? { data: null, error: { code: 'write_failed' } }
      : { data: { id: 'retirement' }, error: null },
  };
  const pointer = {
    update: (value: Record<string, unknown>) => { writes.push(value); return pointer; },
    eq: (column: string, value: unknown) => { filters.push({ [column]: value }); return pointer; },
    select: () => pointer,
    maybeSingle: async () => options.pointerOk === false
      ? { data: null, error: null } : { data: { id: LOCATION }, error: null },
  };
  const db = { rpc, from: (table: string) => table === 'square_connections' ? connectionQuery
    : table === 'square_access_token_retirements' ? retirement : pointer } as unknown as SupabaseClient;
  return { db, calls, writes, filters };
}

export function stubRevoke(
  t: TestContext, success = true,
): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ success });
  });
  return bodies;
}
