import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderPlacedCopy } from './order-placed-copy';

describe('order confirmation copy', () => {
  it('describes a cancelled order without promising payment, preparation, or points', () => {
    assert.deepEqual(orderPlacedCopy({
      status: 'cancelled', isDelivery: false, guestName: 'Ada', window: null,
      pointsEarned: 44, pointsLabel: 'Beans',
    }), {
      title: 'Order cancelled',
      detail: 'This order was cancelled before preparation.',
      paymentLabel: 'Cancelled',
      pointsNote: '44 Beans were not added to your account.',
    });
  });

  it('keeps the fulfillment promise for an active order', () => {
    const copy = orderPlacedCopy({
      status: 'created', isDelivery: true, guestName: 'Ada',
      window: { dayLabel: 'Today', timeLabel: '5:00 PM' },
      pointsEarned: 44, pointsLabel: 'Beans',
    });
    assert.equal(copy.title, 'On its way');
    assert.equal(copy.paymentLabel, 'Due at counter');
    assert.match(copy.detail, /Delivering Ada today, 5:00 PM/);
  });

  it('describes a refunded order without promising fulfillment or points', () => {
    assert.deepEqual(orderPlacedCopy({
      status: 'refunded', isDelivery: false, guestName: 'Ada', window: null,
      pointsEarned: 44, pointsLabel: 'Beans',
    }), {
      title: 'Order refunded',
      detail: 'The payment for this order was refunded.',
      paymentLabel: 'Refunded',
      pointsNote: 'Any Beans earned from this order were reversed.',
    });
  });
});
