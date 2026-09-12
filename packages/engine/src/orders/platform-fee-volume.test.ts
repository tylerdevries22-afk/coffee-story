import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { feeMonthRange } from '../fees';
import { appFeeForCharge } from './platform-fees';

const INPUT = {
  orderId: 'order-a', locationId: 'location-a', chargeCents: 10_000,
  connectionId: '44444444-4444-4444-8444-444444444444',
  connectionGeneration: '55555555-5555-4555-8555-555555555555',
  locationTimezone: 'America/Denver',
  feeConfig: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 1_500_000 },
};

function database(options: {
  error?: boolean; fee?: number; bps?: number; created?: boolean | null;
} = {}) {
  const calls: { url: URL; body: Record<string, unknown> }[] = [];
  const db = createClient('https://database.example.com', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const url = new URL(String(request));
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (options.error) {
        return new Response(JSON.stringify({ code: '40001', message: 'Quote rejected' }), {
          status: 409, headers: { 'Content-Type': 'application/json' },
        });
      }
      return Response.json({
        quoted_fee_cents: options.fee ?? 300,
        quoted_fee_bps_applied: options.bps ?? 300,
        quote_claim_generation: options.created === false ? null : 'claim-a',
        quote_claim_created: options.created === null ? undefined : options.created ?? true,
      });
    } },
  });
  return { db, calls };
}

describe('monthly fee volume reservation', () => {
  it('claims one durable quote with the order, terms, and local month', async () => {
    const { db, calls } = database({ fee: 225, bps: 225 });
    // A bare `new Date()` here and the one inside appFeeForCharge are two
    // independent reads of the clock: once a month, in the few milliseconds
    // either side of the location's local-month boundary, they can land in
    // different months and the range asserted below would not match the one
    // actually sent. Pinning a single instant and passing it to both sides
    // removes the race instead of just making it rarer.
    const now = new Date();
    assert.deepEqual(await appFeeForCharge(db, { ...INPUT, now }), {
      feeCents: 225, feeBpsApplied: 225, claimGeneration: 'claim-a', claimCreated: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url.pathname, '/rest/v1/rpc/claim_platform_fee_quote');
    const range = feeMonthRange(now, INPUT.locationTimezone);
    assert.deepEqual(calls[0]?.body, {
      p_order_id: 'order-a', p_location_id: 'location-a', p_charge_cents: 10_000,
      p_connection_id: INPUT.connectionId, p_connection_generation: INPUT.connectionGeneration,
      p_fee_bps: 300, p_fee_bps_tier2: 150, p_tier_threshold_cents: 1_500_000,
      p_month_start: range.startIso, p_month_end: range.endIso, p_require_existing: false,
    });
  });

  it('surfaces a failed atomic claim instead of guessing a fee', async () => {
    const { db, calls } = database({ error: true });
    await assert.rejects(appFeeForCharge(db, INPUT), { code: '40001' });
    assert.equal(calls.length, 1);
  });

  it('requires the lifecycle flag that distinguishes a fresh claim from replay', async () => {
    await assert.rejects(appFeeForCharge(database({ created: null }).db, INPUT),
      /invalid data/);
    assert.deepEqual(await appFeeForCharge(database({ created: false }).db, INPUT), {
      feeCents: 300, feeBpsApplied: 300, claimGeneration: null, claimCreated: false,
    });
  });

  it('rejects out-of-range rates and provider-ineligible fee quotes before charging', async () => {
    const invalidConfig = { ...INPUT, feeConfig: { ...INPUT.feeConfig, feeBps: 9_001 } };
    const invalidDb = database();
    await assert.rejects(appFeeForCharge(invalidDb.db, invalidConfig), /Invalid platform fee/);
    assert.equal(invalidDb.calls.length, 0);

    const small = { ...INPUT, chargeCents: 499 };
    await assert.rejects(appFeeForCharge(database({ fee: 300 }).db, small), /invalid data/);
    assert.equal((await appFeeForCharge(database({ fee: 299 }).db, small)).feeCents, 299);
  });
});
