import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { it } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { mapSquareEvent } from '../square/webhooks';

import { createSquareCheckoutLink } from './checkout-link';
import { recordPlatformFee } from './platform-fees';

it('records the exact checkout fees when payments settle out of order across a tier change', async (t) => {
  const quoted = new Map<string, number>();
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/v2/online-checkout/payment-links');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      order: { reference_id: string };
      checkout_options: { app_fee_money: { amount: number } };
    };
    const id = body.order.reference_id;
    quoted.set(id, body.checkout_options.app_fee_money.amount);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ payment_link: { url: `https://checkout.example/${id}`, order_id: `sq-${id}` } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const receipts: Record<string, unknown>[] = [];
  let monthGross = 90_000;
  let monthReads = 0;
  const db = createClient('https://database.example', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const url = new URL(String(request));
      const table = url.pathname.split('/').at(-1);
      let data: unknown;
      if (table === 'orders') {
        const id = url.searchParams.get('id')?.replace('eq.', '');
        data = init?.method === 'PATCH' ? null : {
          id, brand_id: 'brand-a', location_id: 'location-a', status: 'created',
          tender_type: 'square_link', tax_cents: 0, tip_cents: 0,
          total_cents: 10_000, stored_value_applied_cents: 0, square_checkout_url: null,
          totals: { lines: [{ name: 'Coffee box', quantity: 1, unit_price_cents: 10_000 }] },
        };
        if (init?.method === 'PATCH') assert.equal('totals' in JSON.parse(String(init.body)), false);
      } else if (table === 'locations') {
        assert.equal(url.searchParams.get('brand_id'), 'eq.brand-a');
        data = { id: 'location-a', timezone: 'America/Denver' };
      } else if (table === 'brands') {
        data = { fee_bps: 300, fee_bps_tier2: 150, tier_threshold_cents: 100_000 };
      } else if (table === 'platform_fees' && init?.method === 'POST') {
        const row = JSON.parse(String(init.body)) as Record<string, unknown>;
        receipts.push(row);
        monthGross += Number(row.gross_cents);
        data = null;
      } else if (table === 'platform_fees') {
        monthReads += 1;
        data = url.searchParams.has('id') ? [] : [{ id: 'prior', gross_cents: monthGross }];
      } else throw new Error(`Unexpected table: ${table}`);
      return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  const deps = {
    db, square: { env: 'sandbox' as const, applicationId: 'app', applicationSecret: 'test-secret',
      apiBase: `http://127.0.0.1:${address.port}` },
    locationAccessToken: 'test-token', squareLocationId: 'sq-location', locationTimezone: 'America/Denver',
    feeConfig: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 100_000 },
  };
  for (const orderId of ['first', 'second']) {
    await createSquareCheckoutLink(deps, { orderId });
    assert.equal(quoted.get(orderId), 300);
  }
  const readsBeforeSettlement = monthReads;
  for (const orderId of ['second', 'first']) {
    const mapped = mapSquareEvent({ event_id: `event-${orderId}`, type: 'payment.updated',
      data: { object: { payment: { id: `pay-${orderId}`, order_id: `sq-${orderId}`, status: 'COMPLETED',
        app_fee_money: { amount: quoted.get(orderId), currency: 'USD' } } } } });
    assert.ok(mapped?.squarePaymentId && mapped.settledFeeCents !== undefined);
    await recordPlatformFee(db, { brandId: 'brand-a', locationId: 'location-a', orderId,
      squarePaymentId: mapped.squarePaymentId, grossCents: 10_000, settledFeeCents: mapped.settledFeeCents });
  }
  assert.equal(monthGross, 110_000);
  assert.deepEqual(receipts.map(row => [row.order_id, row.fee_cents, row.fee_bps_applied]),
    [['second', 300, 300], ['first', 300, 300]]);
  // Settlement never reads mutable monthly totals or the current contract.
  assert.equal(monthReads, readsBeforeSettlement);
});
