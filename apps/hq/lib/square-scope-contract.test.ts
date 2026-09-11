import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SquareConfig } from '@platform/engine';

import { replaceSquareConnection } from './square-admin';
import { adminHarness, tokens } from './square-admin-test-support';
import { SQUARE_OAUTH_SCOPE_CONTRACT_VERSION } from './square-oauth-contract';
import { squareRuntimeFor } from './square-runtime';

describe('Square OAuth scope contract', () => {
  afterEach(() => delete process.env.SQUARE_TOKEN_KEY);

  it('records version 2 on every newly authorized merchant connection', async () => {
    process.env.SQUARE_TOKEN_KEY = Buffer.alloc(32, 4).toString('base64');
    const h = adminHarness({ connection: null });
    const config: SquareConfig = {
      env: 'sandbox', applicationId: 'app', applicationSecret: 'secret', apiBase: 'https://square.test',
    };

    const result = await replaceSquareConnection(h.db, config, {
      brandId: 'brand', locationId: 'location', squareLocationId: 'square-location',
      tokens, previousConnection: null,
    });

    assert.equal(result.ok, true);
    const finalize = h.calls.find((call) =>
      call.name === 'finalize_square_connection_replacement');
    assert.equal(finalize?.args.p_oauth_scope_contract_version, 2);
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
