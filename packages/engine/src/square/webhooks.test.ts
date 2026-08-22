import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { mapSquareEvent, verifySquareSignature } from './webhooks';

const KEY = 'sig-key-from-square-dashboard';
const URL = 'https://hq.example.com/api/webhooks/square';

function sign(body: string): string {
  return createHmac('sha256', KEY).update(URL + body).digest('base64');
}

describe('verifySquareSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = '{"event_id":"e1"}';
    assert.equal(verifySquareSignature(KEY, URL, body, sign(body)), true);
  });

  it('rejects a modified body, a missing header, and a wrong key', () => {
    const body = '{"event_id":"e1"}';
    assert.equal(verifySquareSignature(KEY, URL, body + ' ', sign(body)), false);
    assert.equal(verifySquareSignature(KEY, URL, body, null), false);
    assert.equal(verifySquareSignature('other-key', URL, body, sign(body)), false);
  });
});

describe('mapSquareEvent', () => {
  it('maps a completed payment to paid', () => {
    const mapped = mapSquareEvent({
      event_id: 'e-pay',
      type: 'payment.updated',
      data: { object: { payment: { id: 'PAY1', status: 'COMPLETED', order_id: 'SQORD1' } } },
    });
    assert.deepEqual(mapped, {
      squareEventId: 'e-pay', orderStatus: 'paid', squareOrderId: 'SQORD1', squarePaymentId: 'PAY1', kind: 'payment',
    });
  });

  it('records but does not move on a pending payment', () => {
    const mapped = mapSquareEvent({
      event_id: 'e-pend', type: 'payment.updated',
      data: { object: { payment: { id: 'PAY1', status: 'APPROVED' } } },
    });
    assert.equal(mapped?.orderStatus, null);
  });

  it('maps a completed refund to refunded and a canceled order to cancelled', () => {
    assert.equal(mapSquareEvent({
      event_id: 'e-ref', type: 'refund.updated',
      data: { object: { refund: { id: 'R1', status: 'COMPLETED', payment_id: 'PAY1' } } },
    })?.orderStatus, 'refunded');
    assert.equal(mapSquareEvent({
      event_id: 'e-ord', type: 'order.updated',
      data: { object: { order: { id: 'SQORD1', state: 'CANCELED' } } },
    })?.orderStatus, 'cancelled');
  });

  it('keeps unknown event types as recorded-but-ignored, and drops eventless payloads', () => {
    assert.equal(mapSquareEvent({ event_id: 'e-x', type: 'catalog.version.updated' })?.kind, 'ignored');
    assert.equal(mapSquareEvent({ type: 'payment.updated' }), null);
  });
});
