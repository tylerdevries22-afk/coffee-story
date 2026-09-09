import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { captureSquarePayment } from './capture-payment';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

export function captureFixture(t: TestContext) {
  const state = {
    order: { id: 'order-a', brand_id: 'brand-a', location_id: 'location-a', customer_id: null,
      status: 'created', tender_type: 'square_card',
      totals: { lines: [{ name: 'Coffee', quantity: 1, unit_price_cents: 10_000 }] },
      subtotal_cents: 10_000, tax_cents: 500, tip_cents: 500,
      total_cents: 11_000, stored_value_applied_cents: 1_000,
      square_order_id: null as string | null, square_payment_id: null as string | null },
    missingOrder: false, loadError: false, claimError: false,
    claimCreated: true, claimGeneration: 'claim-a',
    bindAttemptResult: true, cancelOnBind: false, finalizeResult: true, finalizeError: false,
    finalizeCommitsBeforeError: false, reconcileError: false, releasedQuotes: 0,
    releaseResult: true,
    orderProviderStatus: 200, paymentProviderStatus: 200, paymentStatus: 'COMPLETED',
    preboundOrderState: 'OPEN', preboundTenderPaymentId: null as string | null,
    paymentOrderId: 'square-order-a', paymentLocationId: 'sq-location',
    quotedFeeCents: 300, feeCents: 300 as number | null,
    providerOrderTotalCents: 9_500, providerOrderLocationId: 'sq-location',
    providerOrderReferenceId: 'order-a', lostOrderResponses: 0, lostPaymentResponses: 0,
    paymentCommitsBeforeLostResponse: false,
    receipts: [] as Record<string, unknown>[], events: 0,
    dbCalls: [] as { name: string; body: Record<string, unknown> }[],
    providerCalls: [] as { path: string; method: string; body: Record<string, unknown>; bound: boolean }[],
  };
  const settle = (body: Record<string, unknown>) => {
    state.order.square_order_id = state.paymentOrderId;
    state.order.square_payment_id = 'payment-a';
    state.order.status = 'paid';
    if (state.receipts.length === 0) state.receipts.push(body);
    state.events = 1;
  };
  const db = createClient('https://database.example', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const name = new URL(String(request)).pathname.split('/').at(-1) ?? '';
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      state.dbCalls.push({ name, body });
      if (name === 'orders') {
        if (state.loadError) return json({ code: '08006', message: 'load unavailable' }, 503);
        return json(state.missingOrder ? null : state.order);
      }
      if (name === 'claim_platform_fee_quote') {
        if (state.claimError) return json({ code: '22023', message: 'old quote month' }, 400);
        return json({
        quoted_fee_cents: state.quotedFeeCents, quoted_fee_bps_applied: 300,
        quote_claim_generation: state.claimCreated ? state.claimGeneration : null,
        quote_claim_created: state.claimCreated,
      });
      }
      if (name === 'get_square_payment_quote') return json({
        gross_cents: state.order.total_cents - state.order.stored_value_applied_cents,
        quoted_fee_cents: state.quotedFeeCents,
        quoted_fee_bps_applied: 300, quote_finalized: state.order.status === 'paid',
      });
      if (name === 'release_platform_fee_quote') {
        assert.equal(body.p_claim_generation, state.claimGeneration);
        state.releasedQuotes += 1;
        return json(state.releaseResult);
      }
      if (name === 'bind_square_payment_attempt') {
        assert.equal(body.p_claim_generation, state.claimGeneration);
        if (state.cancelOnBind) state.order.status = 'cancelled';
        if (state.bindAttemptResult) state.order.square_order_id = String(body.p_square_order_id);
        return json(state.bindAttemptResult && !state.cancelOnBind);
      }
      if (name === 'finalize_square_card_payment') {
        assert.equal(body.p_claim_generation, state.claimGeneration);
        if (state.finalizeCommitsBeforeError) settle(body);
        if (state.finalizeError || state.finalizeCommitsBeforeError) {
          return json({ code: '08006', message: 'finalize unavailable' }, 503);
        }
        if (state.finalizeResult) settle(body);
        return json(state.finalizeResult);
      }
      if (name === 'record_square_payment_settlement') {
        if (state.reconcileError) return json({ code: '08006', message: 'reconcile unavailable' }, 503);
        settle(body);
        return json(true);
      }
      throw new Error(`Unexpected database call ${name}`);
    } },
  });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const call = { path, method: init?.method ?? 'GET', body, bound: Boolean(state.order.square_order_id) };
    state.providerCalls.push(call);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
    if (path === '/v2/orders') {
      if (state.lostOrderResponses-- > 0) throw new TypeError('response lost');
      if (state.orderProviderStatus !== 200) return json({ errors: [] }, state.orderProviderStatus);
      return json({ order: { id: 'square-order-a', location_id: state.providerOrderLocationId,
        reference_id: state.providerOrderReferenceId,
        total_money: { amount: state.providerOrderTotalCents, currency: 'USD' } } });
    }
    if (path === '/v2/orders/square-order-a') return json({ order: {
      id: 'square-order-a', location_id: 'sq-location', state: state.preboundOrderState, version: 1,
      tenders: state.preboundTenderPaymentId ? [{
        type: 'CARD', id: state.preboundTenderPaymentId,
        payment_id: state.preboundTenderPaymentId,
      }] : [],
    } });
    if (path === '/v2/payments') {
      if (state.lostPaymentResponses-- > 0) {
        if (state.paymentCommitsBeforeLostResponse) {
          state.preboundOrderState = 'COMPLETED';
          state.preboundTenderPaymentId = 'payment-a';
        }
        throw new TypeError('response lost');
      }
      if (state.paymentProviderStatus !== 200) return json({ errors: [] }, state.paymentProviderStatus);
    } else if (path !== '/v2/payments/payment-a') {
      throw new Error(`Unexpected provider path ${path}`);
    } else if (state.paymentProviderStatus !== 200) {
      return json({ errors: [] }, state.paymentProviderStatus);
    }
    return json({ payment: {
      id: 'payment-a', order_id: state.paymentOrderId,
      location_id: state.paymentLocationId, status: state.paymentStatus,
      total_money: {
        amount: state.order.total_cents - state.order.stored_value_applied_cents,
        currency: 'USD',
      },
      ...(state.feeCents === null ? {} : {
        app_fee_money: { amount: state.feeCents, currency: 'USD' },
      }),
    } });
  });
  const deps = {
    db, square: { env: 'sandbox' as const, applicationId: 'app', applicationSecret: 'secret',
      apiBase: 'https://square.example' }, locationAccessToken: 'test-token',
    squareLocationId: 'sq-location', locationTimezone: 'America/Denver',
    feeConfig: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 100_000 },
  };
  return { state, deps,
    capture: () => captureSquarePayment(deps, { orderId: 'order-a', sourceId: 'nonce-a' }) };
}
