import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REWARD_TIERS, pointsForPurchase } from '@/features/rewards/rules';

import {
  DELIVERY_FEE_CENTS,
  TAX_JURISDICTIONS,
  TIP_PRESETS_CENTS,
  orderPurchaseBreakdown,
  orderTotals,
  pointsForOrder,
} from './totals';

describe('TAX_JURISDICTIONS', () => {
  it('states the four authorities that stack on an Aurora sale', () => {
    assert.deepEqual(
      TAX_JURISDICTIONS.map((tax) => [tax.id, tax.rate]),
      [['state', 0.029], ['city', 0.0375], ['rtd', 0.01], ['county', 0.0025]],
    );
  });

  it('adds up to the 7.90% combined rate', () => {
    const combined = TAX_JURISDICTIONS.reduce((total, tax) => total + tax.rate, 0);
    assert.equal(Math.round(combined * 10_000) / 10_000, 0.079);
  });
});

describe('orderTotals', () => {
  it('totals an empty bag at zero rather than NaN', () => {
    const totals = orderTotals({ subtotalCents: 0 });
    assert.deepEqual(
      [totals.subtotalCents, totals.taxCents, totals.tipCents, totals.totalCents],
      [0, 0, 0, 0],
    );
  });

  it('breaks tax out per authority and sums to exactly those rows', () => {
    const totals = orderTotals({ subtotalCents: 4670 });
    assert.deepEqual(totals.taxRows.map((row) => row.amountCents), [135, 175, 47, 12]);
    assert.equal(totals.taxCents, 135 + 175 + 47 + 12);
    assert.equal(
      totals.taxCents,
      totals.taxRows.reduce((sum, row) => sum + row.amountCents, 0),
    );
  });

  it('never lets the printed rows disagree with the tax total', () => {
    // A base whose per-row roundings all land on a half-cent is exactly where a
    // single rounding of the combined rate would drift away from the rows.
    for (let subtotalCents = 1; subtotalCents <= 2000; subtotalCents += 1) {
      const totals = orderTotals({ subtotalCents });
      const summed = totals.taxRows.reduce((sum, row) => sum + row.amountCents, 0);
      assert.equal(totals.taxCents, summed, `rows disagreed at ${subtotalCents}c`);
    }
  });

  it('taxes the delivery fee along with the goods', () => {
    const pickup = orderTotals({ subtotalCents: 1000 });
    const delivery = orderTotals({ subtotalCents: 1000, deliveryFeeCents: DELIVERY_FEE_CENTS });
    assert.equal(delivery.taxableCents, 1000 + DELIVERY_FEE_CENTS);
    assert.ok(delivery.taxCents > pickup.taxCents);
    assert.equal(delivery.totalCents, delivery.taxableCents + delivery.taxCents);
  });

  it('takes the discount off before tax, so a discounted order is not over-taxed', () => {
    const totals = orderTotals({ subtotalCents: 2000, discountCents: 500 });
    assert.equal(totals.taxableCents, 1500);
    assert.equal(totals.taxCents, orderTotals({ subtotalCents: 1500 }).taxCents);
  });

  it('clamps a discount larger than the order rather than creating money', () => {
    const totals = orderTotals({ subtotalCents: 500, discountCents: 9000 });
    assert.equal(totals.discountCents, 500);
    assert.equal(totals.taxableCents, 0);
    assert.equal(totals.taxCents, 0);
    assert.equal(totals.totalCents, 0);
  });

  it('adds the tip on top and never taxes it', () => {
    const withoutTip = orderTotals({ subtotalCents: 1000 });
    const withTip = orderTotals({ subtotalCents: 1000, tipCents: 300 });
    assert.equal(withTip.taxCents, withoutTip.taxCents);
    assert.equal(withTip.totalCents, withoutTip.totalCents + 300);
  });

  it('does not let a shop-side discount shrink the barista tip', () => {
    const totals = orderTotals({ subtotalCents: 2000, discountCents: 1500, tipCents: 300 });
    assert.equal(totals.tipCents, 300);
  });

  it('refuses negative and non-finite inputs instead of propagating them', () => {
    const totals = orderTotals({
      subtotalCents: -500,
      deliveryFeeCents: Number.NaN,
      discountCents: -100,
      tipCents: Number.POSITIVE_INFINITY,
    });
    assert.deepEqual(
      [totals.subtotalCents, totals.deliveryFeeCents, totals.discountCents, totals.tipCents, totals.totalCents],
      [0, 0, 0, 0, 0],
    );
  });

  it('rounds fractional cents rather than truncating them', () => {
    // 1c at 2.90% is 0.029c, which rounds to zero; 1000c is 29c exactly.
    assert.equal(orderTotals({ subtotalCents: 1 }).taxRows[0].amountCents, 0);
    assert.equal(orderTotals({ subtotalCents: 1000 }).taxRows[0].amountCents, 29);
  });

  it('prices the reference order — $4.67 of goods plus a $3 tip — at $8.05', () => {
    // The recording this flow was modelled on shows the same order at $8.06,
    // with $0.15 on its 2.90% state row. 2.90% of $4.67 is $0.1354, which
    // rounds to $0.14, and its other three rows match ours exactly. We round
    // each row to the nearest cent rather than reproducing a discrepancy we
    // cannot account for, so this order comes to $8.05.
    const totals = orderTotals({ subtotalCents: 467, tipCents: 300 });
    assert.deepEqual(totals.taxRows.map((row) => row.amountCents), [14, 18, 5, 1]);
    assert.equal(totals.taxCents, 38);
    assert.equal(totals.totalCents, 805);
  });
});

describe('TIP_PRESETS_CENTS', () => {
  it('offers the $2 / $3 / $5 chips as whole dollars', () => {
    assert.deepEqual(TIP_PRESETS_CENTS, [200, 300, 500]);
    for (const preset of TIP_PRESETS_CENTS) assert.equal(preset % 100, 0);
  });
});

describe('orderPurchaseBreakdown', () => {
  it('splits the taxable base back into goods and delivery without losing a cent', () => {
    const totals = orderTotals({ subtotalCents: 1000, deliveryFeeCents: DELIVERY_FEE_CENTS, tipCents: 200 });
    const breakdown = orderPurchaseBreakdown(totals);
    assert.equal(breakdown.servicesCents + breakdown.deliveryCents, totals.taxableCents);
    assert.equal(breakdown.deliveryCents, DELIVERY_FEE_CENTS);
    assert.equal(breakdown.tipsCents, 200);
  });

  it('keeps both halves non-negative when a discount swallows the order', () => {
    const totals = orderTotals({ subtotalCents: 100, deliveryFeeCents: 399, discountCents: 9999 });
    const breakdown = orderPurchaseBreakdown(totals);
    assert.equal(breakdown.servicesCents, 0);
    assert.equal(breakdown.deliveryCents, 0);
  });

  it('never counts tax as qualifying spend', () => {
    const totals = orderTotals({ subtotalCents: 5000 });
    assert.equal(orderPurchaseBreakdown(totals).taxesCents, totals.taxCents);
    assert.equal(
      pointsForOrder(totals, 0),
      pointsForPurchase(orderPurchaseBreakdown(totals), 0, REWARD_TIERS),
    );
  });
});

describe('pointsForOrder', () => {
  it('scores an order at the guest\'s current tier rate', () => {
    const totals = orderTotals({ subtotalCents: 1000 });
    // First Sip earns 10 per dollar; House Regular earns 12.
    assert.equal(pointsForOrder(totals, 0), 100);
    assert.equal(pointsForOrder(totals, 1500), 120);
  });

  it('counts the tip toward points, matching the ladder\'s existing rule', () => {
    const tipped = orderTotals({ subtotalCents: 1000, tipCents: 500 });
    assert.equal(pointsForOrder(tipped, 0), 150);
  });

  it('earns nothing on an empty order', () => {
    assert.equal(pointsForOrder(orderTotals({ subtotalCents: 0 }), 0), 0);
  });
});
