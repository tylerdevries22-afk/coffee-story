import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { encryptToken, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { inspectDueSquareLink, recoverDueSquareLink } from './square-link-provider';
import type { DueSquareLink } from './square-link-maintenance-types';

const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
  apiBase: 'https://square.example.test',
};
const tokenKey = Buffer.alloc(32, 7);
const orderId = '11111111-1111-4111-8111-111111111111';
function link(over: Partial<DueSquareLink> = {}): DueSquareLink {
  return {
    order_id: orderId, brand_id: 'brand-a',
    location_id: 'location-a', expires_at: '2026-09-08T00:00:00.000Z',
    claim_generation: '22222222-2222-4222-8222-222222222222',
    checkoutUrl: 'https://checkout.example/a', paymentLinkId: 'link-a',
    squareOrderId: 'square-order-a', squareLocationId: 'square-location-a',
    accessTokenEncrypted: encryptToken('access-token', tokenKey),
    grossCents: 1_000, expectedFeeCents: 30, feeBpsApplied: 300, valid: true, ...over,
  };
}
function installKey(t: TestContext): void {
  const prior = process.env.SQUARE_TOKEN_KEY;
  process.env.SQUARE_TOKEN_KEY = tokenKey.toString('base64');
  t.after(() => {
    if (prior === undefined) delete process.env.SQUARE_TOKEN_KEY;
    else process.env.SQUARE_TOKEN_KEY = prior;
  });
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

describe('Square hosted checkout provider recovery', () => {
  it('replays and binds an identity-free link under its cleanup generation', async (t) => {
    installKey(t);
    const rpcCalls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args }); return { data: true, error: null };
    } } as unknown as SupabaseClient;
    const providerBodies: Record<string, unknown>[] = [];
    t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return json({
        payment_link: { id: 'link-a', url: 'https://checkout.example/a', order_id: 'square-order-a' },
        related_resources: { orders: [{
          id: 'square-order-a', location_id: 'square-location-a', reference_id: orderId,
          total_money: { amount: 1_000, currency: 'USD' },
        }] },
      });
    });
    const recovered = await recoverDueSquareLink(db, square, link({
      checkoutUrl: null, paymentLinkId: null, squareOrderId: null,
    }));
    assert.equal(recovered.squareOrderId, 'square-order-a');
    assert.deepEqual((providerBodies[0]?.order as Record<string, unknown>).line_items, [{
      name: 'Card-funded order balance', quantity: '1',
      base_price_money: { amount: 1_000, currency: 'USD' },
    }]);
    assert.deepEqual(rpcCalls, [{ name: 'bind_square_checkout_link', args: {
      p_order_id: recovered.order_id, p_claim_generation: recovered.claim_generation,
      p_checkout_url: recovered.checkoutUrl, p_payment_link_id: recovered.paymentLinkId,
      p_square_order_id: recovered.squareOrderId,
    } }]);
  });

  it('accepts a lost delete response only after exact canceled Order proof', async (t) => {
    installKey(t);
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      requests += 1;
      if (String(input).includes('/payment-links/')) return json({}, 404);
      return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a',
        state: 'CANCELED', version: 4, tenders: [],
      } });
    });
    assert.deepEqual(await inspectDueSquareLink(square, link()), {
      kind: 'cancelled', providerOrderVersion: 4, providerOrderState: 'CANCELED',
    });
    assert.equal(requests, 2);
  });

  it('recovers an exact completed hosted payment when link deletion rejects', async (t) => {
    installKey(t);
    const paths: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path.includes('/payment-links/')) return json({ errors: [] }, 409);
      if (path.includes('/orders/')) return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a', state: 'COMPLETED', version: 5,
        tenders: [{ type: 'CARD', payment_id: 'payment-a' }],
      } });
      return json({ payment: {
        id: 'payment-a', order_id: 'square-order-a', location_id: 'square-location-a',
        status: 'COMPLETED', total_money: { amount: 1_000, currency: 'USD' },
        app_fee_money: { amount: 30, currency: 'USD' },
      } });
    });
    assert.deepEqual(await inspectDueSquareLink(square, link()), {
      kind: 'payment', paymentId: 'payment-a', feeCents: 30,
    });
    assert.deepEqual(paths, [
      '/v2/online-checkout/payment-links/link-a', '/v2/orders/square-order-a',
      '/v2/payments/payment-a',
    ]);
  });

  it('rejects a completed hosted payment with wrong fee or location', async (t) => {
    installKey(t);
    let fee = 29;
    let location = 'square-location-a';
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.includes('/payment-links/')) return json({ errors: [] }, 409);
      if (path.includes('/orders/')) return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a', state: 'COMPLETED', version: 5,
        tenders: [{ type: 'CARD', payment_id: 'payment-a' }],
      } });
      return json({ payment: {
        id: 'payment-a', order_id: 'square-order-a', location_id: location,
        status: 'COMPLETED', total_money: { amount: 1_000, currency: 'USD' },
        app_fee_money: { amount: fee, currency: 'USD' },
      } });
    });
    await assert.rejects(inspectDueSquareLink(square, link()), /invalid settlement/);
    fee = 30; location = 'wrong-location';
    await assert.rejects(inspectDueSquareLink(square, link()), /identity could not be confirmed/);
  });
});
