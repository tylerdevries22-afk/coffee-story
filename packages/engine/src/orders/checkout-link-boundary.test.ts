import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { createSquareCheckoutLink } from './checkout-link';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fixture(t: TestContext, options: {
  storedUrl?: string;
  failClaim?: boolean;
  failBind?: boolean;
} = {}) {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  const db = createClient('https://database.example', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const rpc = new URL(String(request)).pathname.split('/').at(-1) ?? '';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ rpc, body });
      if (rpc === 'orders') {
        return response({
          id: 'order-a',
          brand_id: 'brand-a',
          location_id: 'location-a',
          status: 'created',
          tender_type: 'square_link',
          totals: { lines: [{ name: 'Coffee', quantity: 1, unit_price_cents: 1_000 }] },
          tax_cents: 0,
          tip_cents: 0,
          total_cents: 1_000,
          stored_value_applied_cents: 0,
          square_checkout_url: options.storedUrl ?? null,
          square_payment_link_id: options.storedUrl ? 'link-existing' : null,
        });
      }
      if (rpc === 'claim_platform_fee_quote') {
        if (options.failClaim) {
          return response({ code: 'P0001', message: 'platform_fee_quote_missing' }, 409);
        }
        return response({
          quoted_fee_cents: 30,
          quoted_fee_bps_applied: 300,
          quote_claim_created: true,
          quote_claim_generation: 'claim-a',
        });
      }
      if (rpc === 'bind_square_checkout_link') {
        if (options.failBind) return response({ code: '40001', message: 'stale claim' }, 409);
        return response(true);
      }
      throw new Error(`Unexpected database call: ${rpc}`);
    } },
  });
  let providerCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    providerCalls += 1;
    return response({ payment_link: {
      id: 'link-a',
      url: 'https://checkout.example/order-a',
      order_id: 'square-order-a',
    } });
  });
  const deps = {
    db,
    square: { env: 'sandbox' as const, applicationId: 'app', applicationSecret: 'secret',
      apiBase: 'https://square.example' },
    locationAccessToken: 'token',
    squareLocationId: 'square-location',
    locationTimezone: 'America/Denver',
    feeConfig: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 100_000 },
  };
  return {
    calls,
    providerCalls: () => providerCalls,
    create: () => createSquareCheckoutLink(deps, { orderId: 'order-a' }),
  };
}

test('stored checkout links replay only through an existing durable quote', async (t) => {
  const f = fixture(t, { storedUrl: 'https://checkout.example/existing' });
  assert.deepEqual(await f.create(), {
    orderId: 'order-a',
    checkoutUrl: 'https://checkout.example/existing',
    replayed: true,
  });
  const claim = f.calls.find(call => call.rpc === 'claim_platform_fee_quote');
  assert.equal(claim?.body.p_require_existing, true);
  assert.equal(f.providerCalls(), 0);
});

test('a missing stored-link quote fails closed before contacting Square', async (t) => {
  const f = fixture(t, { storedUrl: 'https://checkout.example/existing', failClaim: true });
  await assert.rejects(f.create(), { code: 'P0001' });
  assert.equal(f.providerCalls(), 0);
});

test('a stale post-provider bind is surfaced without releasing its quote', async (t) => {
  const f = fixture(t, { failBind: true });
  await assert.rejects(f.create(), /link link-a was created but could not be recorded/);
  assert.equal(f.providerCalls(), 1);
  const bind = f.calls.find(call => call.rpc === 'bind_square_checkout_link');
  assert.deepEqual(bind?.body, {
    p_order_id: 'order-a',
    p_claim_generation: 'claim-a',
    p_checkout_url: 'https://checkout.example/order-a',
    p_payment_link_id: 'link-a',
    p_square_order_id: 'square-order-a',
  });
  assert.equal(f.calls.some(call => call.rpc === 'release_platform_fee_quote'), false);
});
