import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import type { LocationFeeTerms } from '../fees';
import { recordPlatformFee } from './platform-fees';

const INPUT = {
  brandId: 'brand-a', locationId: 'location-a', orderId: 'order-a',
  squarePaymentId: 'payment-a', grossCents: 10_000, settledFeeCents: 150,
};

function database(options: {
  location?: LocationFeeTerms;
  locationError?: boolean;
  insertError?: string;
} = {}) {
  const requests: URL[] = [];
  const inserted: Record<string, unknown>[] = [];
  const db = createClient('https://database.example.com', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (request, init) => {
        const url = new URL(String(request));
        requests.push(url);
        const table = url.pathname.split('/').at(-1);
        let data: unknown;
        let status = 200;
        if (table === 'brands') {
          data = { fee_bps: 300, fee_bps_tier2: 200, tier_threshold_cents: 100_000 };
        } else if (table === 'locations') {
          assert.equal(url.searchParams.get('brand_id'), 'eq.brand-a');
          assert.equal(url.searchParams.get('id'), 'eq.location-a');
          assert.equal(url.searchParams.get('select'), 'id');
          data = { timezone: 'America/Denver', ...options.location };
          if (options.locationError) {
            status = 406;
            data = { code: 'PGRST116', message: 'Location not found in this brand' };
          }
        } else if (table === 'platform_fees' && init?.method === 'POST') {
          inserted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          data = null;
          if (options.insertError) {
            status = 409;
            data = { code: options.insertError, message: 'Insert failed' };
          }
        } else if (table === 'platform_fees') {
          data = [];
        } else {
          throw new Error(`Unexpected test request: ${url.pathname}`);
        }
        return new Response(JSON.stringify(data), {
          status, headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return { db, requests, inserted };
}

describe('settlement fee terms', () => {
  it('records the negotiated location rate charged at checkout', async () => {
    const { db, inserted } = database({ location: { fee_bps: 150 } });
    await recordPlatformFee(db, INPUT);
    assert.deepEqual(inserted, [{
      brand_id: INPUT.brandId, location_id: INPUT.locationId, order_id: INPUT.orderId,
      gross_cents: 10_000, fee_cents: 150, fee_bps_applied: 150,
      square_payment_id: INPUT.squarePaymentId,
    }]);
  });

  it('records the collected blended rate after the location terms change', async () => {
    const { db, inserted } = database({
      location: { fee_bps: null, fee_bps_tier2: 100, tier_threshold_cents: 5_000 },
    });
    await recordPlatformFee(db, { ...INPUT, settledFeeCents: 200 });
    assert.equal(inserted[0]?.fee_cents, 200);
    assert.equal(inserted[0]?.fee_bps_applied, 200);
  });

  it('records the brand rate when all overrides are null', async () => {
    const { db, inserted } = database({
      location: { fee_bps: null, fee_bps_tier2: null, tier_threshold_cents: null },
    });
    await recordPlatformFee(db, { ...INPUT, settledFeeCents: 300 });
    assert.equal(inserted[0]?.fee_cents, 300);
  });

  it('does not insert a fee for a missing or cross-brand location', async () => {
    const { db, inserted } = database({ locationError: true });
    await assert.rejects(recordPlatformFee(db, INPUT), { code: 'PGRST116' });
    assert.equal(inserted.length, 0);
  });

  it('retains idempotent inserts and surfaces other database failures', async () => {
    await recordPlatformFee(database({ insertError: '23505' }).db, INPUT);
    await assert.rejects(recordPlatformFee(database({ insertError: '23503' }).db, INPUT), {
      code: '23503',
    });
  });

  it('records zero collected fees without losing the payment volume', async () => {
    const { db, requests, inserted } = database();
    await recordPlatformFee(db, { ...INPUT, settledFeeCents: 0 });
    assert.equal(inserted[0]?.fee_cents, 0);
    assert.equal(inserted[0]?.gross_cents, 10_000);
    assert.equal(inserted[0]?.fee_bps_applied, 0);
    assert.equal(requests.some(url => url.pathname.endsWith('/brands')), false);
    assert.equal(requests.filter(url => url.pathname.endsWith('/platform_fees')).length, 1);
  });

  it('rejects invalid provider money before making database calls', async () => {
    const { db, requests } = database();
    for (const settledFeeCents of [-1, 0.5, NaN, Infinity, 10_001, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(recordPlatformFee(db, { ...INPUT, settledFeeCents }), RangeError);
    }
    for (const grossCents of [-1, 0.5, NaN, Infinity]) {
      await assert.rejects(recordPlatformFee(db, { ...INPUT, grossCents }), RangeError);
    }
    assert.equal(requests.length, 0);
  });

  it('does not query the database for a zero-value payment', async () => {
    const { db, requests } = database();
    await recordPlatformFee(db, { ...INPUT, grossCents: 0, settledFeeCents: 0 });
    assert.equal(requests.length, 0);
  });
});
