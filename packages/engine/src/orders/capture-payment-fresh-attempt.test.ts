import assert from 'node:assert/strict';
import test from 'node:test';

import { captureFixture } from './capture-payment.test-support';

// The test-support fixture defaults orderProviderStatus to 200 and nothing in
// the existing suite overrides it, so a definitive (non-retryable) rejection
// from Square's /v2/orders on a fresh capture attempt had no coverage: the
// quote claimed just before the provider call would leak unless
// releasePlatformFeeQuote is actually reached.
test('a definitive Square order rejection releases the claimed fee quote before any payment attempt', async (t) => {
  const f = captureFixture(t);
  f.state.orderProviderStatus = 422; // 4xx, not one of the retryable codes (408/409/425/429)
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.releasedQuotes, 1);
  assert.equal(f.state.providerCalls.some(call => call.path === '/v2/payments'), false);
  assert.equal(f.state.dbCalls.some(call => call.name === 'bind_square_payment_attempt'), false);
});

// The recovery path (capture-payment-recovery.ts) already asserts the
// provider payment is attached to the exact bound order. The same identity
// check on a FIRST attempt -- capture-payment.ts:171, right after the
// provider payment call returns -- had no direct test: every other test
// that varies paymentOrderId presets square_order_id/square_payment_id so it
// exercises recovery instead.
test('a fresh capture rejects a payment attached to a different provider order', async (t) => {
  const f = captureFixture(t);
  f.state.paymentOrderId = 'different-order';
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.providerCalls.filter(call => call.path === '/v2/payments').length, 1);
  assert.equal(f.state.dbCalls.some(call => call.name === 'finalize_square_card_payment'), false);
  assert.equal(f.state.events, 0);
});
