import assert from 'node:assert/strict';
import test from 'node:test';

import { captureFixture } from './capture-payment.test-support';

test('lost Square order and payment responses replay stable provider identities', async (t) => {
  const f = captureFixture(t);
  f.state.lostOrderResponses = 1;
  f.state.lostPaymentResponses = 1;
  await f.capture();
  const orders = f.state.providerCalls.filter(call => call.path === '/v2/orders');
  const payments = f.state.providerCalls.filter(call => call.path === '/v2/payments');
  assert.equal(orders.length, 2);
  assert.equal(payments.length, 2);
  assert.deepEqual(new Set(orders.map(call => call.body.idempotency_key)), new Set(['order-order-a']));
  assert.deepEqual(new Set(payments.map(call => call.body.idempotency_key)), new Set(['pay-order-a']));
  assert.equal(payments.every(call => call.bound), true);
});

test('live-claim replay never receives or uses the owner generation', async (t) => {
  const f = captureFixture(t);
  f.state.claimCreated = false;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.providerCalls.length, 0);
  assert.equal(f.state.dbCalls.some(call => call.name === 'bind_square_payment_attempt'), false);
});

test('prebound tender recovery never posts a changed card token', async (t) => {
  const f = captureFixture(t);
  f.state.claimError = true; // an old-month quote would reject a fresh claim
  f.state.order.square_order_id = 'square-order-a';
  f.state.preboundOrderState = 'COMPLETED';
  f.state.preboundTenderPaymentId = 'payment-a';
  await f.capture();
  assert.equal(f.state.providerCalls.some(call => call.path === '/v2/payments'), false);
  assert.deepEqual(f.state.providerCalls.map(call => call.path), [
    '/v2/orders/square-order-a', '/v2/payments/payment-a',
  ]);
  assert.equal(f.state.dbCalls.some(call => call.name === 'claim_platform_fee_quote'), false);
  assert.equal(f.state.dbCalls.at(-1)?.name, 'record_square_payment_settlement');
});

test('a prebound order without a tender waits for maintenance instead of reusing the payment key', async (t) => {
  const f = captureFixture(t);
  f.state.order.square_order_id = 'square-order-a';
  f.state.preboundOrderState = 'OPEN';
  f.state.preboundTenderPaymentId = null;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.deepEqual(f.state.providerCalls.map(call => call.path), ['/v2/orders/square-order-a']);
  assert.equal(f.state.dbCalls.some(call => call.name === 'claim_platform_fee_quote'), false);
});

test('a fully lost charge response is recovered on the next invocation', async (t) => {
  const f = captureFixture(t);
  f.state.lostPaymentResponses = 2;
  f.state.paymentCommitsBeforeLostResponse = true;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  const postsAfterLoss = f.state.providerCalls.filter(call => call.path === '/v2/payments').length;
  await f.capture();
  assert.equal(f.state.providerCalls.filter(call => call.path === '/v2/payments').length, postsAfterLoss);
  assert.equal(f.state.dbCalls.at(-1)?.name, 'record_square_payment_settlement');
});

test('stale pre-charge claimant stops before sending card data', async (t) => {
  const f = captureFixture(t);
  f.state.bindAttemptResult = false;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.providerCalls.some(call => call.path === '/v2/payments'), false);
});

test('cancellation between provider-order creation and binding prevents a late charge', async (t) => {
  const f = captureFixture(t);
  f.state.cancelOnBind = true;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.providerCalls.some(call => call.path === '/v2/payments'), false);
});

test('recovery rejects a payment that is not attached to the exact bound order', async (t) => {
  const f = captureFixture(t);
  f.state.order.square_order_id = 'square-order-a';
  f.state.order.square_payment_id = 'payment-a';
  f.state.paymentOrderId = 'different-order';
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.dbCalls.some(call => call.name === 'record_square_payment_settlement'), false);
});

test('the atomic finalizer accepts provider settlement without extra fee or event writes', async (t) => {
  const f = captureFixture(t);
  await f.capture();
  assert.equal(f.state.order.status, 'paid');
  assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.events, 1);
  assert.equal(f.state.dbCalls.some(call => call.name === 'platform_fees'), false);
  assert.equal(f.state.dbCalls.some(call => call.name === 'order_events'), false);
});
