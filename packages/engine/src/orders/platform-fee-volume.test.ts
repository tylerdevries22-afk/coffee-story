import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { feeMonthRange } from '../fees';
import { appFeeForCharge } from './platform-fees';

const INPUT = {
  locationId: 'location-a', chargeCents: 10_000, locationTimezone: 'America/Denver',
  feeConfig: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 1_500_000 },
};

function database(rowCount: number, cap: number, failPage?: number) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: String(index).padStart(8, '0'), gross_cents: 1_000,
  }));
  const calls: URL[] = [];
  const db = createClient('https://database.example.com', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request) => {
      const url = new URL(String(request));
      calls.push(url);
      assert.equal(url.searchParams.get('location_id'), 'eq.location-a');
      assert.equal(url.searchParams.get('order'), 'id.asc');
      assert.equal(url.searchParams.get('limit'), '1000');
      const range = feeMonthRange(new Date(), INPUT.locationTimezone);
      assert.deepEqual(url.searchParams.getAll('created_at'), [
        `gte.${range.startIso}`, `lt.${range.endIso}`,
      ]);
      if (calls.length === failPage) {
        return new Response(JSON.stringify({ code: '42501', message: 'Read rejected' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        });
      }
      const cursor = url.searchParams.get('id')?.slice(3);
      const page = rows.filter((row) => !cursor || row.id > cursor).slice(0, cap);
      return new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  return { db, calls };
}

describe('monthly fee volume pagination', () => {
  it('uses every row beyond the API cap when choosing the volume tier', async () => {
    const { db, calls } = database(2_000, 1_000);
    assert.deepEqual(await appFeeForCharge(db, INPUT), { feeCents: 150, feeBpsApplied: 150 });
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.searchParams.get('id'), null);
    assert.equal(calls[1]?.searchParams.get('id'), 'gt.00000999');
    assert.equal(calls[2]?.searchParams.get('id'), 'gt.00001999');
  });

  it('continues when a deployment caps responses below the requested page size', async () => {
    const { db, calls } = database(1_601, 500);
    assert.equal((await appFeeForCharge(db, INPUT)).feeCents, 150);
    assert.equal(calls.length, 5);
  });

  it('uses the base rate for an empty month', async () => {
    const { db, calls } = database(0, 1_000);
    assert.deepEqual(await appFeeForCharge(db, INPUT), { feeCents: 300, feeBpsApplied: 300 });
    assert.equal(calls.length, 1);
  });

  it('fails instead of charging against a partial sum when a later page fails', async () => {
    const { db, calls } = database(2_000, 1_000, 2);
    await assert.rejects(appFeeForCharge(db, INPUT), { code: '42501' });
    assert.equal(calls.length, 2);
  });
});
