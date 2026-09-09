import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, loadTokenKey } from '@platform/engine';

import { squareRuntimeFor, type BrandFeeRow } from './square-runtime';

export const BRAND = '11111111-1111-4111-8111-111111111111';
export const LOCATION = '22222222-2222-4222-8222-222222222222';
export const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
export const DAY = 24 * 60 * 60 * 1000;
const brand: BrandFeeRow = { fee_bps: 250, fee_bps_tier2: 150, tier_threshold_cents: 500_000 };

export type ConnectionRow = {
  square_location_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  updated_at: string | null;
  oauth_scope_contract_version: number;
};

export type DbState = {
  connection: ConnectionRow | null;
  updates: Record<string, unknown>[];
  retirementWrites?: Record<string, unknown>[];
  updateFilters?: Record<string, unknown>[];
  updateResults?: Array<{
    data: { location_id: string } | null;
    error: { message: string } | null;
  }>;
};

function runtimeDb(state: DbState): SupabaseClient {
  const location = {
    select: () => location, eq: () => location,
    maybeSingle: async () => ({
      data: { id: LOCATION, timezone: 'America/Denver', fee_bps: null, fee_bps_tier2: null, tier_threshold_cents: null },
      error: null,
    }),
  };
  const connection = {
    select: () => connection,
    eq: () => connection,
    gte: () => connection,
    maybeSingle: async () => ({ data: state.connection, error: null }),
    update: (values: Record<string, unknown>) => {
      state.updates.push(values);
      const update = {
        eq: (column: string, value: unknown) => { state.updateFilters?.push({ [column]: value }); return update; },
        is: (column: string, value: unknown) => { state.updateFilters?.push({ [column]: value }); return update; },
        select: () => update,
        maybeSingle: async () => state.updateResults?.shift() ?? {
          data: { location_id: LOCATION }, error: null,
        },
      };
      return update;
    },
  };
  const retirement = {
    insert: (values: Record<string, unknown>) => { state.retirementWrites?.push(values); return retirement; },
    select: () => retirement,
    maybeSingle: async () => ({ data: { id: 'retirement' }, error: null }),
  };
  return { from: (table: string) => table === 'locations' ? location
    : table === 'square_access_token_retirements' ? retirement : connection } as unknown as SupabaseClient;
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
    square_location_id: 'SQ-LOC',
    access_token_encrypted: encryptToken('stored-access', key),
    refresh_token_encrypted: encryptToken('stored-refresh', key),
    expires_at: at(60 * DAY), updated_at: at(-DAY), oauth_scope_contract_version: 2,
    ...over,
  };
}

export const resolve = (state: DbState) =>
  squareRuntimeFor(runtimeDb(state), { brandId: BRAND, locationId: LOCATION, brand });
