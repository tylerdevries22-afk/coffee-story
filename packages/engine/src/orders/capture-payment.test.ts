import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { captureSquarePayment } from './capture-payment';

function fixture(t: TestContext) {
  const state = {
    order: { id: 'order-a', brand_id: 'brand-a', location_id: 'location-a', customer_id: null,
      status: 'created', tender_type: 'square_card',
      totals: { lines: [{ name: 'Coffee', quantity: 1, unit_price_cents: 10_000 }] },
      subtotal_cents: 10_000, tip_cents: 500, total_cents: 11_000, stored_value_applied_cents: 1_000,
      square_order_id: null as string | null, square_payment_id: null as string | null },
    missingOrder: false, loadError: false, monthGross: 90_000, failFee: false, failLink: false, failEvent: false,
    providerStatus: 200, paymentStatus: 'COMPLETED', feeCents: 300, releasedQuotes: 0,
    receipts: [] as Record<string, unknown>[], events: [] as Record<string, unknown>[],
    calls: [] as { path: string; method: string; body: Record<string, unknown> }[],
  };
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const db = createClient('https://database.example', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const url = new URL(String(request));
      const table = url.pathname.split('/').at(-1);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (table === 'orders') {
        if (state.loadError) return response({ code: '08006', message: 'load unavailable' }, 503);
        return response(state.missingOrder ? null : state.order);
      }
      if (table === 'claim_platform_fee_quote') {
        assert.equal(body.p_order_id, state.order.id);
        return response({
          quoted_fee_cents: 300,
          quoted_fee_bps_applied: 300,
          quote_claim_generation: 'claim-a',
          quote_claim_created: true,
        });
      }
      if (table === 'release_platform_fee_quote') {
        assert.equal(body.p_order_id, state.order.id);
        assert.equal(body.p_claim_generation, 'claim-a');
        state.releasedQuotes += 1;
        return response(true);
      }
      if (table === 'bind_square_payment') {
        assert.equal(body.p_order_id, state.order.id);
        assert.equal(body.p_claim_generation, 'claim-a');
        if (state.failLink) return response({ code: '08006', message: 'link unavailable' }, 503);
        Object.assign(state.order, {
          square_order_id: body.p_square_order_id,
          square_payment_id: body.p_square_payment_id,
        });
        return response(true);
      }
      if (table === 'bind_square_payment_attempt') {
        assert.equal(body.p_claim_generation, 'claim-a');
        state.order.square_order_id = String(body.p_square_order_id);
        return response(true);
      }
      if (table === 'platform_fees' && init?.method === 'POST') {
        if (state.failFee) return response({ code: '08006', message: 'fee unavailable' }, 503);
        if (state.receipts.length) return response({ code: '23505', message: 'existing receipt' }, 409);
        state.receipts.push(body);
        return response(null);
      }
      if (table === 'platform_fees') return response(url.searchParams.has('id')
        ? [] : [{ id: 'prior', gross_cents: state.monthGross }]);
      if (table === 'order_events') {
        if (state.failEvent) return response({ code: '08006', message: 'event unavailable' }, 503);
        state.events.push(body);
        state.order.status = 'paid';
        return response(null);
      }
      throw new Error(`Unexpected table ${table}`);
    } },
  });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    state.calls.push({ path, method: init?.method ?? 'GET', body });
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
    if (state.providerStatus !== 200 && path.startsWith('/v2/payments')) {
      return response({ errors: [] }, state.providerStatus);
    }
    if (path === '/v2/orders') return response({ order: { id: 'square-order-a' } });
    if (path.startsWith('/v2/payments')) return response({ payment: {
      id: 'payment-a', status: state.paymentStatus, total_money: { amount: 10_000, currency: 'USD' },
      app_fee_money: { amount: state.feeCents, currency: 'USD' },
    } });
    throw new Error(`Unexpected provider path ${path}`);
  });
  const deps = {
    db, square: { env: 'sandbox' as const, applicationId: 'app', applicationSecret: 'test-secret',
      apiBase: 'https://square.example' },
    locationAccessToken: 'test-token', squareLocationId: 'sq-location', locationTimezone: 'America/Denver',
    feeConfig: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 100_000 },
  };
  return { state, deps, capture: () => captureSquarePayment(deps, { orderId: 'order-a', sourceId: 'nonce-a' }) };
}

test('capture records actual settled money and includes tip, stored value and idempotency keys', async (t) => {
  const f = fixture(t);
  await f.capture();
  const request = f.state.calls.find(call => call.path === '/v2/payments');
  assert.equal(request?.body.idempotency_key, 'pay-order-a');
  assert.deepEqual(request?.body.amount_money, { amount: 9500, currency: 'USD' });
  assert.deepEqual(request?.body.tip_money, { amount: 500, currency: 'USD' });
  assert.deepEqual(request?.body.app_fee_money, { amount: 300, currency: 'USD' });
  assert.equal(f.state.receipts[0]?.gross_cents, 10_000);
  assert.equal(f.state.receipts[0]?.fee_cents, 300);
  assert.equal(f.state.events.length, 1);
  await f.capture();
  assert.equal(f.state.calls.filter(call => call.path === '/v2/payments').length, 1);
  assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.events.length, 1);
});

test('linked capture recovery keeps the provider fee after another payment crosses the tier', async (t) => {
  const f = fixture(t);
  f.state.failFee = true;
  await assert.rejects(f.capture(), { code: '08006' });
  assert.equal(f.state.order.square_payment_id, 'payment-a');
  assert.equal(f.state.events.length, 0);
  f.state.failFee = false;
  f.state.monthGross = 100_000;
  f.deps.feeConfig.feeBps = 999; // a renegotiated contract cannot alter an old receipt
  await f.capture();
  assert.equal(f.state.receipts[0]?.fee_cents, 300);
  assert.equal(f.state.receipts[0]?.fee_bps_applied, 300);
  assert.equal(f.state.calls.at(-1)?.path, '/v2/payments/payment-a');
  assert.equal(f.state.calls.at(-1)?.method, 'GET');
  assert.equal(f.state.calls.filter(call => call.path === '/v2/payments').length, 1);
});

test('capture surfaces a post-charge linkage failure without publishing success', async (t) => {
  const f = fixture(t);
  f.state.failLink = true;
  await assert.rejects(f.capture(), /could not be recorded/);
  assert.deepEqual([f.state.receipts.length, f.state.events.length], [0, 0]);
});

test('capture repairs an event failure without duplicating the receipt or charge', async (t) => {
  const f = fixture(t);
  f.state.failEvent = true;
  await assert.rejects(f.capture(), { code: '08006' });
  assert.equal(f.state.receipts.length, 1);
  f.state.failEvent = false;
  await f.capture();
  assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.events.length, 1);
  assert.equal(f.state.calls.filter(call => call.path === '/v2/payments').length, 1);
});

test('failed provider recovery retries and leaves all local payment state unchanged', async (t) => {
  const f = fixture(t);
  f.state.order.square_payment_id = 'payment-a';
  f.state.providerStatus = 503;
  await assert.rejects(f.capture(), /External provider request failed/);
  assert.equal(f.state.calls.length, 2);
  assert.equal(f.state.receipts.length, 0);
  assert.equal(f.state.events.length, 0);
});

test('a definitive provider rejection releases its monthly fee reservation', async (t) => {
  const f = fixture(t);
  f.state.providerStatus = 402;
  await assert.rejects(f.capture(), /Square POST \/v2\/payments -> 402/);
  assert.equal(f.state.releasedQuotes, 1);
  assert.equal(f.state.receipts.length, 0);
  assert.equal(f.state.events.length, 0);
});

test('an uncertain provider failure keeps its fee reservation for safe replay', async (t) => {
  const f = fixture(t);
  f.state.providerStatus = 503;
  await assert.rejects(f.capture(), /External provider request failed/);
  assert.equal(f.state.releasedQuotes, 0);
});

test('non-completed provider receipts never mark an order paid', async (t) => {
  const f = fixture(t);
  f.state.paymentStatus = 'APPROVED';
  await assert.rejects(f.capture(), /invalid settlement receipt/);
  assert.deepEqual([f.state.receipts.length, f.state.events.length], [0, 0]);
});

test('invalid orders and read failures stop before any provider charge', async (t) => {
  const f = fixture(t);
  f.state.missingOrder = true;
  await assert.rejects(f.capture(), /does not exist/);
  f.state.missingOrder = false;
  f.state.loadError = true;
  await assert.rejects(f.capture(), { code: '08006' });
  f.state.loadError = false;
  f.state.order.status = 'cancelled';
  await assert.rejects(f.capture(), /only a created order/);
  assert.deepEqual([f.state.calls.length, f.state.events.length], [0, 0]);
});
