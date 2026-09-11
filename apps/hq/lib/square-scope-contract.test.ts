import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OAuthTokens, SquareConfig } from '@platform/engine';

import { replaceSquareConnection } from './square-admin';
import { SQUARE_OAUTH_SCOPE_CONTRACT_VERSION } from './square-oauth-contract';
import { squareRuntimeFor } from './square-runtime';

describe('Square OAuth scope contract', () => {
  afterEach(() => delete process.env.SQUARE_TOKEN_KEY);

  it('records version 2 on every newly authorized merchant connection', async () => {
    process.env.SQUARE_TOKEN_KEY = Buffer.alloc(32, 4).toString('base64');
    const writes: Record<string, unknown>[] = [];
    const query = {
      insert: (value: Record<string, unknown>) => { writes.push(value); return query; },
      select: () => query,
      single: async () => ({ data: { id: 'connection' }, error: null }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;
    const config: SquareConfig = {
      env: 'sandbox', applicationId: 'app', applicationSecret: 'secret', apiBase: 'https://square.test',
    };
    const tokens: OAuthTokens = {
      access_token: 'access', refresh_token: 'refresh', merchant_id: 'merchant',
      expires_at: '2026-10-08T00:00:00.000Z',
    };

    const result = await replaceSquareConnection(db, config, {
      brandId: 'brand', locationId: 'location', squareLocationId: 'square-location',
      tokens, previousConnection: null,
    });

    assert.equal(result.ok, true);
    assert.equal(writes[0]?.oauth_scope_contract_version, 2);
  });

  it('filters payment runtime reads to the application contract version', async () => {
    const filters: unknown[] = [];
    const location = {
      select: () => location, eq: () => location,
      maybeSingle: async () => ({
        data: { id: 'location', timezone: null, fee_bps: null, fee_bps_tier2: null, tier_threshold_cents: null },
        error: null,
      }),
    };
    const connection = {
      select: () => connection,
      eq: () => connection,
      gte: (column: string, value: unknown) => {
        if (column === 'oauth_scope_contract_version') filters.push({ column, value });
        return connection;
      },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const db = {
      from: (table: string) => table === 'locations' ? location : connection,
    } as unknown as SupabaseClient;

    const runtime = await squareRuntimeFor(db, {
      brandId: 'brand', locationId: 'location',
      brand: { fee_bps: 250, fee_bps_tier2: 150, tier_threshold_cents: 500_000 },
    });

    assert.equal(runtime, null);
    assert.deepEqual(filters, [{
      column: 'oauth_scope_contract_version',
      value: SQUARE_OAUTH_SCOPE_CONTRACT_VERSION,
    }]);
  });
});
