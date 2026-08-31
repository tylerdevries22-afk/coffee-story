import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { recordSquareConnectionPointer } from './square-admin';

const BRAND = '11111111-1111-4111-8111-111111111111';
const LOCATION = '22222222-2222-4222-8222-222222222222';

describe('recordSquareConnectionPointer', () => {
  it('scopes the pointer to the brand and confirms the row was actually updated', async () => {
    const filters: Record<string, unknown>[] = [];
    const query = {
      update: () => query,
      eq: (column: string, value: unknown) => {
        filters.push({ [column]: value });
        return query;
      },
      select: () => query,
      maybeSingle: async () => ({ data: { id: LOCATION }, error: null }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;

    assert.equal(await recordSquareConnectionPointer(db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), true);
    assert.deepEqual(filters, [{ id: LOCATION }, { brand_id: BRAND }]);
  });

  it('does not call a zero-row update success', async () => {
    const query = {
      update: () => query,
      eq: () => query,
      select: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;

    assert.equal(await recordSquareConnectionPointer(db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), false);
  });

  it('fails closed when the database rejects the update', async () => {
    const query = {
      update: () => query,
      eq: () => query,
      select: () => query,
      maybeSingle: async () => ({ data: null, error: { message: 'write failed' } }),
    };
    const db = { from: () => query } as unknown as SupabaseClient;

    assert.equal(await recordSquareConnectionPointer(db, {
      brandId: BRAND, locationId: LOCATION, connectionId: 'connection',
    }), false);
  });
});
