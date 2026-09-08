import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { feeMonthRange } from '../fees';
import { appFeeForCharge } from './platform-fees';

const INPUT = {
  orderId: 'order-a', locationId: 'location-a', chargeCents: 10_000,
  locationTimezone: 'America/Denver',
  feeConfig: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 1_500_000 },
};

function database(options: { error?: boolean; fee?: number; bps?: number } = {}) {
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
      });
    } },
  });
  return { db, calls };
}

describe('monthly fee volume reservation', () => {
  it('claims one durable quote with the order, terms, and local month', async () => {
    const { db, calls } = database({ fee: 225, bps: 225 });
    assert.deepEqual(await appFeeForCharge(db, INPUT), {
      feeCents: 225, feeBpsApplied: 225,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url.pathname, '/rest/v1/rpc/claim_platform_fee_quote');
    const range = feeMonthRange(new Date(), INPUT.locationTimezone);
    assert.deepEqual(calls[0]?.body, {
      p_order_id: 'order-a', p_location_id: 'location-a', p_charge_cents: 10_000,
      p_fee_bps: 300, p_fee_bps_tier2: 150, p_tier_threshold_cents: 1_500_000,
      p_month_start: range.startIso, p_month_end: range.endIso,
    });
  });

  it('surfaces a failed atomic claim instead of guessing a fee', async () => {
    const { db, calls } = database({ error: true });
    await assert.rejects(appFeeForCharge(db, INPUT), { code: '40001' });
    assert.equal(calls.length, 1);
  });
});
