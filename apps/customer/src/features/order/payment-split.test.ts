import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  POINTS_PER_DOLLAR_REDEEMED,
  maxRedeemableCents,
  pointsForRedemption,
  splitPayment,
} from './payment-split';

describe('maxRedeemableCents', () => {
  it('is capped by both the balance and the subtotal, in whole dollars', () => {
    // 130 Beans at 20/dollar = $6 redeemable; a $4.75 subtotal caps at $4.
    assert.equal(maxRedeemableCents(130, 475), 400);
    assert.equal(maxRedeemableCents(130, 999), 600);
  });

  it('redeems nothing below one whole dollar of points', () => {
    assert.equal(maxRedeemableCents(POINTS_PER_DOLLAR_REDEEMED - 1, 1000), 0);
  });

  it('fails safe on nonsense input', () => {
    assert.equal(maxRedeemableCents(-50, 1000), 0);
    assert.equal(maxRedeemableCents(50.5, 1000), 0);
    assert.equal(maxRedeemableCents(100, -5), 0);
  });
});

describe('pointsForRedemption', () => {
  it('charges points for the dollars taken', () => {
    assert.equal(pointsForRedemption(400), 80);
    assert.equal(pointsForRedemption(0), 0);
  });
});

describe('splitPayment', () => {
  it('covers the whole total when the balance allows', () => {
    assert.deepEqual(splitPayment(805, 2000, true), { storedValueAppliedCents: 805, cardChargeCents: 0 });
  });

  it('tops up with the card when the balance falls short', () => {
    assert.deepEqual(splitPayment(805, 300, true), { storedValueAppliedCents: 300, cardChargeCents: 505 });
  });

  it('charges the card alone when stored value is off or empty', () => {
    assert.deepEqual(splitPayment(805, 300, false), { storedValueAppliedCents: 0, cardChargeCents: 805 });
    assert.deepEqual(splitPayment(805, 0, true), { storedValueAppliedCents: 0, cardChargeCents: 805 });
  });
});
