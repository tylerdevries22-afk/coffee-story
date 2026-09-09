import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createClient } from '@supabase/supabase-js';
import { createSquareCheckoutLink } from './checkout-link';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function fixture(t: TestContext, options: {
  storedUrl?: string; partialStored?: boolean; liveClaim?: boolean;
  failBind?: boolean; bindFalse?: boolean; missingOrderId?: boolean;
  lostProviderResponses?: number; loseBindResponse?: boolean;
  storedValueCents?: number; taxCents?: number; tipCents?: number;
  providerTotalDelta?: number; providerReferenceId?: string;
} = {}) {
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  let claimCalls = 0;
  let providerFailures = options.lostProviderResponses ?? 0;
  let bindResponseLost = false;
  const stored = {
    url: options.partialStored ? 'https://checkout.example/order-a'
      : options.storedUrl ?? null as string | null,
    linkId: options.partialStored ? 'link-a'
      : options.storedUrl ? 'link-existing' : null as string | null,
    orderId: options.storedUrl && !options.partialStored ? 'order-existing' : null as string | null,
  };
  const db = createClient('https://database.example', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const rpc = new URL(String(request)).pathname.split('/').at(-1) ?? '';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ rpc, body });
      if (rpc === 'orders') {
        const taxCents = options.taxCents ?? 0;
        const tipCents = options.tipCents ?? 0;
        return response({
          id: 'order-a',
          brand_id: 'brand-a',
          location_id: 'location-a',
          status: 'created',
          tender_type: 'square_link',
          totals: { lines: [{ name: 'Coffee', quantity: 1, unit_price_cents: 1_000 }] },
          tax_cents: taxCents,
          tip_cents: tipCents,
          total_cents: 1_000 + taxCents + tipCents,
          stored_value_applied_cents: options.storedValueCents ?? 0,
          square_checkout_url: stored.url,
          square_payment_link_id: stored.linkId,
          square_order_id: stored.orderId,
        });
      }
      if (rpc === 'claim_platform_fee_quote') {
        claimCalls += 1;
        const live = options.liveClaim || options.partialStored || claimCalls > 1;
        return response({
          quoted_fee_cents: 30,
          quoted_fee_bps_applied: 300,
          quote_claim_generation: live ? null : 'claim-a',
          quote_claim_created: !live,
        });
      }
      if (rpc === 'bind_square_checkout_link' || rpc === 'bind_square_checkout_link_replay') {
        if (options.failBind) return response({ code: '40001', message: 'stale claim' }, 409);
        if (!options.bindFalse) {
          stored.url = String(body.p_checkout_url);
          stored.linkId = String(body.p_payment_link_id);
          stored.orderId = String(body.p_square_order_id);
        }
        if (options.loseBindResponse && !bindResponseLost) {
          bindResponseLost = true;
          return response({ code: '08006', message: 'response lost' }, 503);
        }
        return response(!options.bindFalse);
      }
      throw new Error(`Unexpected database call: ${rpc}`);
    } },
  });
  let providerCalls = 0;
  let providerBody: Record<string, unknown> | null = null;
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls += 1;
    providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (providerFailures-- > 0) throw new TypeError('response lost');
    const chargeCents = 1_000 + (options.taxCents ?? 0) + (options.tipCents ?? 0)
      - (options.storedValueCents ?? 0);
    return response({ payment_link: {
      id: 'link-a',
      url: 'https://checkout.example/order-a',
      ...(!options.missingOrderId ? { order_id: 'square-order-a' } : {}),
    }, related_resources: { orders: [{
      id: 'square-order-a', location_id: 'square-location',
      reference_id: options.providerReferenceId ?? 'order-a',
      total_money: { amount: chargeCents + (options.providerTotalDelta ?? 0), currency: 'USD' },
    }] } });
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
    providerBody: () => providerBody,
    providerCalls: () => providerCalls,
    create: () => createSquareCheckoutLink(deps, { orderId: 'order-a' }),
  };
}

test('stored checkout links replay without reclaiming their finalized quote', async (t) => {
  const f = fixture(t, { storedUrl: 'https://checkout.example/existing' });
  assert.deepEqual(await f.create(), {
    orderId: 'order-a',
    checkoutUrl: 'https://checkout.example/existing',
    replayed: true,
  });
  assert.equal(f.calls.some(call => call.rpc === 'claim_platform_fee_quote'), false);
  assert.equal(f.providerCalls(), 0);
});
test('partial stored checkout identity is completed only by exact provider replay', async (t) => {
  const f = fixture(t, { partialStored: true });
  assert.equal((await f.create()).replayed, true);
  assert.equal(f.providerCalls(), 1);
  assert.equal(f.calls.some(call => call.rpc === 'bind_square_checkout_link_replay'), true);
});
test('a live checkout owner is not displaced by a replay', async (t) => {
  const f = fixture(t, { liveClaim: true });
  assert.equal((await f.create()).replayed, true);
  assert.equal(f.providerCalls(), 1);
  assert.equal(f.calls.some(call => call.rpc === 'bind_square_checkout_link_replay'), true);
  assert.equal(f.calls.some(call => call.rpc === 'release_platform_fee_quote'), false);
});

test('a lost provider response recovers through the identical deterministic replay', async (t) => {
  const f = fixture(t, { lostProviderResponses: 2 });
  await assert.rejects(f.create(), { code: 'payment_unavailable' });
  assert.equal((await f.create()).replayed, true);
  assert.equal(f.calls.some(call => call.rpc === 'bind_square_checkout_link_replay'), true);
});

test('a lost bind response replays the locally persisted checkout without another provider call', async (t) => {
  const f = fixture(t, { loseBindResponse: true });
  await assert.rejects(f.create(), { code: 'payment_unavailable' });
  assert.equal((await f.create()).replayed, true);
  assert.equal(f.providerCalls(), 1);
});

test('a stale post-provider bind is surfaced without releasing its quote', async (t) => {
  const f = fixture(t, { failBind: true });
  await assert.rejects(f.create(), /could not be secured/);
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

test('a false stale-claim result is also refused before checkout is published', async (t) => {
  const f = fixture(t, { bindFalse: true });
  await assert.rejects(f.create(), { code: 'payment_unavailable' });
  assert.equal(f.calls.some(call => call.rpc === 'release_platform_fee_quote'), false);
});

test('provider links without a Square order identity remain pending for safe replay', async (t) => {
  const f = fixture(t, { missingOrderId: true });
  await assert.rejects(f.create(), { code: 'payment_unavailable' });
  assert.equal(f.calls.some(call => call.rpc === 'bind_square_checkout_link'), false);
});

test('hosted checkout uses one exact card-funded balance after stored value', async (t) => {
  const f = fixture(t, { storedValueCents: 1_150, taxCents: 200, tipCents: 100 });
  await f.create();
  const order = f.providerBody()?.order as Record<string, unknown>;
  assert.deepEqual(order.line_items, [{
    name: 'Card-funded order balance', quantity: '1',
    base_price_money: { amount: 150, currency: 'USD' },
  }]);
  assert.equal(order.discounts, undefined);
  assert.equal(order.service_charges, undefined);
});

test('hosted checkout rejects wrong provider totals and references before binding', async (t) => {
  for (const options of [{ providerTotalDelta: 1 }, { providerReferenceId: 'wrong-order' }]) {
    const f = fixture(t, options);
    await assert.rejects(f.create(), { code: 'payment_unavailable' });
    assert.equal(f.calls.some(call => call.rpc.startsWith('bind_square_checkout_link')), false);
  }
});
