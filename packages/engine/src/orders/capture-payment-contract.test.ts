import assert from 'node:assert/strict';
import test from 'node:test';

import { captureFixture } from './capture-payment.test-support';

test('capture rejects a provider order whose calculated total differs', async (t) => {
  const f = captureFixture(t);
  f.state.providerOrderTotalCents = 9_501;
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.dbCalls.some(call => call.name === 'bind_square_payment_attempt'), false);
  assert.equal(f.state.providerCalls.some(call => call.path === '/v2/payments'), false);
});

test('capture rejects a provider order for another location or reference', async (t) => {
  for (const field of ['providerOrderLocationId', 'providerOrderReferenceId'] as const) {
    const f = captureFixture(t);
    f.state[field] = 'wrong-identity';
    await assert.rejects(f.capture(), { code: 'payment_unavailable' });
    assert.equal(f.state.providerCalls.some(call => call.path === '/v2/payments'), false);
  }
});

test('capture rejects missing, zero, or understated provider application fees', async (t) => {
  for (const [name, fee] of [['missing', null], ['zero', 0], ['understated', 299]] as const) {
    await t.test(name, async (child) => {
      const f = captureFixture(child);
      f.state.feeCents = fee;
      await assert.rejects(f.capture(), { code: 'payment_unavailable' });
      assert.equal(f.state.dbCalls.some(call => call.name === 'finalize_square_card_payment'), false);
    });
  }
});

test('capture rejects a payment returned for another Square location', async (t) => {
  const f = captureFixture(t);
  f.state.paymentLocationId = 'wrong-location';
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.dbCalls.some(call => call.name === 'finalize_square_card_payment'), false);
});

test('stored value covering merchandise and tax still creates the exact card-funded order', async (t) => {
  const f = captureFixture(t);
  f.state.order.stored_value_applied_cents = 10_750;
  f.state.providerOrderTotalCents = 250;
  f.state.quotedFeeCents = 7;
  f.state.feeCents = 7;
  await f.capture();
  const order = f.state.providerCalls.find(call => call.path === '/v2/orders');
  const payment = f.state.providerCalls.find(call => call.path === '/v2/payments');
  assert.deepEqual(order?.body.order, {
    location_id: 'sq-location', reference_id: 'order-a',
    line_items: [{ name: 'Card-funded order balance', quantity: '1',
      base_price_money: { amount: 250, currency: 'USD' } }],
  });
  assert.deepEqual(payment?.body.amount_money, { amount: 250, currency: 'USD' });
  assert.equal(payment?.body.tip_money, undefined);
});

test('invalid tax and stored-value totals stop before claiming or provider calls', async (t) => {
  const f = captureFixture(t);
  f.state.order.stored_value_applied_cents = 11_000;
  await assert.rejects(f.capture(), { code: 'invalid_request' });
  assert.equal(f.state.dbCalls.some(call => call.name === 'claim_platform_fee_quote'), false);
  assert.equal(f.state.providerCalls.length, 0);
});
