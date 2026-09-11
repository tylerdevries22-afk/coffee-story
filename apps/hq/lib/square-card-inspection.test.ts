import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { encryptToken, type SquareConfig } from '@platform/engine';

import { inspectDueSquareCard } from './square-card-inspection';
import type { DueSquareCard } from './square-card-maintenance-types';

const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
  apiBase: 'https://square.example.test',
};
const tokenKey = Buffer.alloc(32, 7);
function card(over: Partial<DueSquareCard> = {}): DueSquareCard {
  return {
    orderId: '11111111-1111-4111-8111-111111111111',
    brandId: '22222222-2222-4222-8222-222222222222',
    locationId: '33333333-3333-4333-8333-333333333333',
    expiresAt: '2026-09-08T00:00:00.000Z',
    claimGeneration: '44444444-4444-4444-8444-444444444444',
    squareOrderId: 'square-order-a', squarePaymentId: null,
    squareLocationId: 'square-location-a', grossCents: 1_000,
    providerOrderTotalCents: 1_000,
    expectedFeeCents: 30, feeBpsApplied: 300,
    accessTokenEncrypted: encryptToken('access-token', tokenKey), valid: true, ...over,
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
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

describe('Square card provider inspection', () => {
  it('requires cleanup to recover a Square order before provider inspection', async (t) => {
    installKey(t);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls += 1; return json({}); });
    await assert.rejects(inspectDueSquareCard(square, card({ squareOrderId: null })),
      /must be recovered first/);
    assert.equal(calls, 0);
  });

  it('cancels the permanent payment key and exact order before unpaid cleanup', async (t) => {
    installKey(t);
    const calls: { path: string; method: string; body: unknown }[] = [];
    t.mock.method(globalThis, 'fetch', async (
      input: RequestInfo | URL, init?: RequestInit,
    ) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === '/v2/payments/cancel') return json({});
      if (init?.method === 'PUT') return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a',
        state: 'CANCELED', version: 8, tenders: [],
      } });
      return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a',
        state: 'OPEN', version: 7, tenders: [],
      } });
    });
    assert.deepEqual(await inspectDueSquareCard(square, card()), {
      kind: 'unpaid', squareOrderId: 'square-order-a', providerOrderVersion: 8,
      providerOrderState: 'CANCELED', squarePaymentId: null, providerPaymentState: null,
    });
    assert.deepEqual(calls.map(({ path, method }) => ({ path, method })), [
      { path: '/v2/payments/cancel', method: 'POST' },
      { path: '/v2/orders/square-order-a', method: 'GET' },
      { path: '/v2/orders/square-order-a', method: 'PUT' },
    ]);
    assert.deepEqual(calls[0]?.body, {
      idempotency_key: 'pay-11111111-1111-4111-8111-111111111111',
    });
  });

  it('reconciles an exact completed payment even when its cancellation rejects', async (t) => {
    installKey(t);
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v2/payments/cancel') return json({ errors: [] }, 409);
      if (path.includes('/v2/orders/')) return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a',
        state: 'COMPLETED', version: 4,
        tenders: [{ type: 'CARD', payment_id: 'payment-a' }],
      } });
      return json({ payment: {
        id: 'payment-a', order_id: 'square-order-a', location_id: 'square-location-a',
        status: 'COMPLETED', total_money: { amount: 1_000, currency: 'USD' },
        app_fee_money: { amount: 30, currency: 'USD' },
      } });
    });
    assert.deepEqual(await inspectDueSquareCard(square, card()), {
      kind: 'payment', paymentId: 'payment-a', feeCents: 30,
    });
  });

  it('retains the lease when cancellation fails and no payment is visible', async (t) => {
    installKey(t);
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v2/payments/cancel') return json({ errors: [] }, 400);
      return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a',
        state: 'OPEN', version: 4, tenders: [],
      } });
    });
    await assert.rejects(inspectDueSquareCard(square, card()), /ambiguity remains/);
  });

  for (const paymentState of ['FAILED', 'CANCELED'] as const) {
    it(`records terminal ${paymentState} evidence only after provider order cancellation`, async (t) => {
      installKey(t);
      t.mock.method(globalThis, 'fetch', async (
        input: RequestInfo | URL, init?: RequestInit,
      ) => {
        const path = new URL(String(input)).pathname;
        if (path === '/v2/payments/cancel') return json({});
        if (path.includes('/v2/payments/')) return json({ payment: {
          id: 'payment-a', order_id: 'square-order-a',
          location_id: 'square-location-a', status: paymentState,
        } });
        const state = init?.method === 'PUT' ? 'CANCELED' : 'OPEN';
        return json({ order: {
          id: 'square-order-a', location_id: 'square-location-a',
          state, version: init?.method === 'PUT' ? 9 : 8,
          tenders: [{ type: 'CARD', payment_id: 'payment-a' }],
        } });
      });
      assert.deepEqual(await inspectDueSquareCard(square, card()), {
        kind: 'unpaid', squareOrderId: 'square-order-a', providerOrderVersion: 9,
        providerOrderState: 'CANCELED', squarePaymentId: 'payment-a',
        providerPaymentState: paymentState,
      });
    });
  }

  it('rejects missing, understated, or wrong-location settlement evidence', async (t) => {
    installKey(t);
    let fee: number | undefined = 30;
    let providerLocation = 'square-location-a';
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v2/payments/cancel') return json({}, 409);
      if (path.includes('/v2/orders/')) return json({ order: {
        id: 'square-order-a', location_id: 'square-location-a',
        state: 'COMPLETED', version: 1,
        tenders: [{ type: 'CARD', payment_id: 'payment-a' }],
      } });
      return json({ payment: {
        id: 'payment-a', order_id: 'square-order-a', location_id: providerLocation,
        status: 'COMPLETED', total_money: { amount: 1_000, currency: 'USD' },
        ...(fee === undefined ? {} : { app_fee_money: { amount: fee, currency: 'USD' } }),
      } });
    });
    for (const invalidFee of [undefined, 0, 29]) {
      fee = invalidFee;
      await assert.rejects(inspectDueSquareCard(square, card()), /invalid settlement/);
    }
    fee = 30;
    providerLocation = 'wrong-location';
    await assert.rejects(inspectDueSquareCard(square, card()), /identity could not be confirmed/);
  });
});
