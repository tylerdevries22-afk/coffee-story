import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  manualRefundEvent,
  refundedCentsFrom,
  replayForClaimedRefund,
  replayForRequest,
  replayForSquareRefund,
  type RefundEventRecord,
} from './refunds';

const REQUEST_KEY = '11111111-1111-4111-8111-111111111111';

function event(
  orderId: string,
  refundId: string,
  snapshot: Record<string, unknown>,
): RefundEventRecord {
  const amount = snapshot.amount_cents ?? snapshot.refunded_cents;
  const requestKey = snapshot.request_key;
  return {
    brand_id: 'brand-1',
    order_id: orderId,
    square_refund_id: refundId,
    refund_cents: typeof amount === 'number' ? amount : null,
    refund_request_key: typeof requestKey === 'string' ? requestKey : null,
    snapshot,
  };
}

describe('refundedCentsFrom', () => {
  it('counts manual and webhook refunds once per Square refund id', () => {
    assert.equal(refundedCentsFrom([
      event('order-1', 'refund-1', { refund_id: 'refund-1', amount_cents: 500 }),
      event('order-1', 'refund-1', { refund_id: 'refund-1', amount_cents: 500 }),
      event('order-1', 'refund-2', { square_refund_id: 'refund-2', refunded_cents: 200 }),
    ]), 700);
  });
});

describe('replayForRequest', () => {
  it('returns a completed attempt only for the same requested amount', () => {
    const events = [event('order-1', 'refund-1', {
      refund_id: 'refund-1', amount_cents: 500, requested_amount: 'full', request_key: REQUEST_KEY,
    })];
    assert.deepEqual(
      replayForRequest(events, {
        brandId: 'brand-1', orderId: 'order-1', requestKey: REQUEST_KEY, amountCents: 'full',
      }),
      { outcome: 'match', result: { orderId: 'order-1', refundId: 'refund-1', amountCents: 500 } },
    );
    assert.deepEqual(
      replayForRequest(events, {
        brandId: 'brand-1', orderId: 'order-1', requestKey: REQUEST_KEY, amountCents: 500,
      }),
      { outcome: 'conflict' },
    );
    assert.deepEqual(
      replayForRequest(events, {
        brandId: 'brand-1', orderId: 'order-2', requestKey: REQUEST_KEY, amountCents: 'full',
      }),
      { outcome: 'conflict' },
    );
    const partialKey = '22222222-2222-4222-8222-222222222222';
    assert.deepEqual(
      replayForRequest([event('order-1', 'refund-2', {
        refund_id: 'refund-2', amount_cents: 200, requested_amount: 200, request_key: partialKey,
      })], { brandId: 'brand-1', orderId: 'order-1', requestKey: partialKey, amountCents: 200 }),
      { outcome: 'match', result: { orderId: 'order-1', refundId: 'refund-2', amountCents: 200 } },
    );
  });
});

describe('replayForSquareRefund', () => {
  it('accepts only the same order, amount, and unique Square refund id', () => {
    const winner = event('order-1', 'refund-1', { square_refund_id: 'refund-1', refunded_cents: 500 });
    assert.deepEqual(
      replayForSquareRefund(winner, {
        brandId: 'brand-1', orderId: 'order-1', refundId: 'refund-1', amountCents: 500,
      }),
      { orderId: 'order-1', refundId: 'refund-1', amountCents: 500 },
    );
    assert.equal(
      replayForSquareRefund(winner, {
        brandId: 'brand-1', orderId: 'order-2', refundId: 'refund-1', amountCents: 500,
      }),
      null,
    );
    assert.equal(
      replayForSquareRefund(winner, {
        brandId: 'brand-1', orderId: 'order-1', refundId: 'refund-1', amountCents: 400,
      }),
      null,
    );
  });
});

describe('replayForClaimedRefund', () => {
  it('requires the processor winner and attended request intent to match together', () => {
    const claimed = event('order-1', 'refund-1', {
      square_event: 'refund.updated',
      square_event_id: 'event-1',
      square_refund_id: 'refund-1',
      refunded_cents: 500,
      request_key: REQUEST_KEY,
      requested_amount: 'full',
    });
    assert.deepEqual(replayForClaimedRefund(claimed, {
      brandId: 'brand-1', orderId: 'order-1', refundId: 'refund-1', refundCents: 500,
      requestKey: REQUEST_KEY, requestedAmount: 'full',
    }), { orderId: 'order-1', refundId: 'refund-1', amountCents: 500 });
    assert.equal(replayForClaimedRefund(claimed, {
      brandId: 'brand-1', orderId: 'order-1', refundId: 'refund-1', refundCents: 500,
      requestKey: '22222222-2222-4222-8222-222222222222', requestedAmount: 'full',
    }), null);
    assert.equal(replayForClaimedRefund(claimed, {
      brandId: 'brand-1', orderId: 'order-1', refundId: 'refund-1', refundCents: 500,
      requestKey: REQUEST_KEY, requestedAmount: 500,
    }), null);
  });
});

describe('manualRefundEvent', () => {
  it('persists both the unique Square id and the caller attempt identity', () => {
    const row = manualRefundEvent({
      brandId: 'brand-1', orderId: 'order-1', type: 'paid', refundId: 'refund-1',
      amountCents: 500, requestedAmount: 500, requestKey: REQUEST_KEY, reason: 'Courtesy',
      partial: true, actorUserId: 'staff-1',
    });
    assert.equal(row.square_refund_id, 'refund-1');
    assert.equal(row.refund_cents, 500);
    assert.equal(row.refund_request_key, REQUEST_KEY);
    assert.deepEqual(row.snapshot, {
      refund_id: 'refund-1', amount_cents: 500, requested_amount: 500,
      request_key: REQUEST_KEY, reason: 'Courtesy', partial: true,
    });
  });
});
