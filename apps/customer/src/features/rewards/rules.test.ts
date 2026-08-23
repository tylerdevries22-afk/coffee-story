import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pointsExpireAt,
  pointsForPurchase,
  nextTier,
  qualifyingSpendCents,
  rewardMilestoneStates,
  tierForAnnualPoints,
  type PurchaseBreakdown,
} from './rules';

const purchase: PurchaseBreakdown = {
  itemsCents: 10000,
  giftCardsCents: 2500,
  deliveryCents: 500,
  tipsCents: 1500,
  taxesCents: 850,
  serviceFeesCents: 300,
  paidWithGiftCardCents: 2000,
  paidWithRewardsCents: 0,
};

test('assigns each annual tier at its exact threshold', () => {
  assert.deepEqual([0, 500, 1500, 2500].map((value) => tierForAnnualPoints(value).name), [
    'First Sip',
    'Daily Ritual',
    'House Regular',
    'Coffee Legend',
  ]);
});

test('excludes taxes, item fees, and covered tender from qualifying spend', () => {
  assert.equal(qualifyingSpendCents(purchase), 12500);
});

test('applies the current tier earn rate and rounds down', () => {
  assert.equal(pointsForPurchase(purchase, 1500), 1500);
});

test('expires points exactly one calendar year after earning', () => {
  assert.equal(pointsExpireAt(new Date('2026-02-28T12:00:00Z')).toISOString(), '2027-02-28T12:00:00.000Z');
  assert.throws(() => pointsExpireAt(new Date('invalid')), RangeError);
});

test('returns the next locked tier or null at Coffee Legend', () => {
  assert.equal(nextTier(1641)?.name, 'Coffee Legend');
  assert.equal(nextTier(2500), null);
});

test('marks only earned annual reward milestones as complete', () => {
  assert.deepEqual(rewardMilestoneStates(1_500), [true, true, true, false]);
  assert.deepEqual(rewardMilestoneStates(Number.NaN), [true, false, false, false]);
});
