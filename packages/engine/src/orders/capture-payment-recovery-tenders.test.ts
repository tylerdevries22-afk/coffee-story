import assert from 'node:assert/strict';
import test from 'node:test';

import { captureFixture } from './capture-payment.test-support';

/**
 * cardTenderPaymentId (capture-payment-recovery.ts:19-33) guards a prebound
 * provider order's tenders before a retry can reuse the identity it finds:
 * more than one tender, a non-CARD tender, or a payment_id/id pair that
 * disagree are all refused. Only the zero-tender and clean-single-CARD shapes
 * were covered elsewhere. Every case below keeps the identity that WOULD be
 * returned if its guard were missing pinned to 'payment-a' -- the id the
 * fixture's default receipt answers for -- so a missing guard turns the
 * rejection into a silent success instead of merely changing the error path.
 */
function preboundFixture(t: Parameters<typeof captureFixture>[0]) {
  const f = captureFixture(t);
  f.state.order.square_order_id = 'square-order-a';
  return f;
}

test('recovery rejects a prebound order carrying more than one tender', async (t) => {
  const f = preboundFixture(t);
  f.state.preboundTenders = [
    { type: 'CARD', id: 'payment-a', payment_id: 'payment-a' },
    { type: 'CARD', id: 'payment-b', payment_id: 'payment-b' },
  ];
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.providerCalls.some(call => call.path === '/v2/payments'), false);
  assert.equal(f.state.dbCalls.some(call => call.name === 'record_square_payment_settlement'), false);
});

test('recovery rejects a prebound order whose tender is not a card', async (t) => {
  const f = preboundFixture(t);
  f.state.preboundTenders = [{ type: 'CASH', id: 'payment-a', payment_id: 'payment-a' }];
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.dbCalls.some(call => call.name === 'record_square_payment_settlement'), false);
});

test('recovery rejects a prebound tender with conflicting payment and tender ids', async (t) => {
  const f = preboundFixture(t);
  f.state.preboundTenders = [{ type: 'CARD', id: 'something-else', payment_id: 'payment-a' }];
  await assert.rejects(f.capture(), { code: 'payment_unavailable' });
  assert.equal(f.state.dbCalls.some(call => call.name === 'record_square_payment_settlement'), false);
});
