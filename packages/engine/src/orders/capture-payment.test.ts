import assert from 'node:assert/strict';
import test from 'node:test';

import { captureFixture } from './capture-payment.test-support';

test('capture binds the provider order before one permanently keyed charge', async (t) => {
  const f = captureFixture(t);
  await f.capture();
  const request = f.state.providerCalls.find(call => call.path === '/v2/payments');
  assert.equal(request?.bound, true);
  assert.equal(request?.body.idempotency_key, 'pay-order-a');
  assert.deepEqual(request?.body.amount_money, { amount: 9500, currency: 'USD' });
  assert.deepEqual(request?.body.tip_money, { amount: 500, currency: 'USD' });
  assert.deepEqual(request?.body.app_fee_money, { amount: 300, currency: 'USD' });
  assert.equal(request?.body.location_id, 'sq-location');
  const providerOrder = f.state.providerCalls.find(call => call.path === '/v2/orders');
  assert.deepEqual(providerOrder?.body.order, {
    location_id: 'sq-location', reference_id: 'order-a',
    line_items: [{ name: 'Card-funded order balance', quantity: '1',
      base_price_money: { amount: 9_500, currency: 'USD' } }],
  });
  const finalizer = f.state.dbCalls.find(call => call.name === 'finalize_square_card_payment');
  assert.deepEqual(finalizer?.body, {
    p_order_id: 'order-a', p_claim_generation: 'claim-a',
    p_square_order_id: 'square-order-a', p_square_payment_id: 'payment-a',
    p_settled_fee_cents: 300,
  });
  assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.events, 1);
});

test('lost finalizer response recovers without changing the charged fee or key', async (t) => {
  const f = captureFixture(t);
  f.state.finalizeCommitsBeforeError = true;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  f.state.finalizeCommitsBeforeError = false;
  f.deps.feeConfig.feeBps = 999;
  await f.capture();
  assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.providerCalls.filter(call => call.path === '/v2/payments').length, 1);
  assert.equal(f.state.providerCalls.at(-1)?.path, '/v2/payments/payment-a');
  assert.equal(f.state.dbCalls.at(-1)?.name, 'record_square_payment_settlement');
});

test('a stale finalizer never publishes local success after provider capture', async (t) => {
  const f = captureFixture(t);
  f.state.finalizeResult = false;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.deepEqual([f.state.receipts.length, f.state.events], [0, 0]);
});

test('provider recovery is strict, bounded, and leaves local state unchanged on failure', async (t) => {
  const f = captureFixture(t);
  f.state.order.square_order_id = 'square-order-a';
  f.state.order.square_payment_id = 'payment-a';
  f.state.paymentProviderStatus = 503;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.providerCalls.length, 2);
  assert.equal(f.state.receipts.length, 0);
  assert.equal(f.state.events, 0);
});

test('a live quote owner is never displaced or released by a replay', async (t) => {
  const f = captureFixture(t);
  f.state.claimCreated = false;
  f.state.order.square_order_id = 'square-order-a';
  await assert.rejects(f.capture(), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'payment_unavailable');
    assert.match(error.message, /being reconciled/u);
    return true;
  });
  assert.equal(f.state.releasedQuotes, 0);
  assert.equal(f.state.providerCalls.filter(call => call.method !== 'GET').length, 0);
});

test('uncertain failures preserve the claim and invalid receipts never finalize', async (t) => {
  const uncertain = captureFixture(t);
  uncertain.state.paymentProviderStatus = 503;
  await assert.rejects(uncertain.capture(), { code: 'payment_unavailable' });
  assert.equal(uncertain.state.releasedQuotes, 0);

  const incomplete = captureFixture(t);
  incomplete.state.paymentStatus = 'APPROVED';
  await assert.rejects(incomplete.capture(), { code: 'payment_unavailable' });
  assert.equal(incomplete.state.dbCalls.some(call => call.name === 'finalize_square_card_payment'), false);
});

test('invalid orders and database read failures stop before provider calls', async (t) => {
  const f = captureFixture(t);
  f.state.missingOrder = true;
  await assert.rejects(f.capture(), /does not exist/u);
  f.state.missingOrder = false;
  f.state.loadError = true;
  await assert.rejects(f.capture(), { code: '08006' });
  f.state.loadError = false;
  f.state.order.status = 'cancelled';
  await assert.rejects(f.capture(), /only a created order/u);
  assert.equal(f.state.providerCalls.length, 0);
});
