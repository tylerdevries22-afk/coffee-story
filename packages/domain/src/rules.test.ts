import assert from 'node:assert/strict';
import test from 'node:test';

import coffeeStory from '../../../tenants/coffee-story/brand.json';
import template from '../../../tenants/_template/brand.json';
import {
  pointsExpireAt,
  pointsForPurchase,
  nextTier,
  qualifyingSpendCents,
  resolveRewardTiers,
  rewardMilestoneStates,
  rewardTiersFrom,
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
    'Member',
    'Regular',
    'Insider',
    'Legend',
  ]);
});

test('the shipped ladder names no trade', () => {
  // It is what a brand renders before it writes its own, so a rung that says
  // "Coffee Legend" tells a bakery's guests they are in the wrong shop.
  const shipped = [0, 500, 1500, 2500]
    .flatMap((value) => [tierForAnnualPoints(value).name, tierForAnnualPoints(value).description]);
  for (const word of ['coffee', 'espresso', 'sip', 'brew', 'roast', 'bean']) {
    assert.ok(
      !shipped.some((line) => line.toLowerCase().includes(word)),
      `the shipped ladder says "${word}"`,
    );
  }
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

test('returns the next locked tier or null at the top rung', () => {
  assert.equal(nextTier(1641)?.name, 'Legend');
  assert.equal(nextTier(2500), null);
});

test('marks only earned annual reward milestones as complete', () => {
  assert.deepEqual(rewardMilestoneStates(1_500), [true, true, true, false]);
  assert.deepEqual(rewardMilestoneStates(Number.NaN), [true, false, false, false]);
});

test('reads the ladder the tenant published, sorted', () => {
  const tiers = rewardTiersFrom([
    { name: 'Top', minimumAnnualPoints: 900, pointsPerDollar: 12, description: 'd', perks: ['p', 7] },
    { name: '  Base  ', minimumAnnualPoints: 0, pointsPerDollar: 10 },
  ]);
  assert.deepEqual(tiers, [
    { name: 'Base', minimumAnnualPoints: 0, pointsPerDollar: 10, description: '', perks: [] },
    { name: 'Top', minimumAnnualPoints: 900, pointsPerDollar: 12, description: 'd', perks: ['p'] },
  ]);
});

test('refuses a ladder it cannot apply whole', () => {
  // Half a ladder is a guest on a rung the owner never published, and every
  // rung carries an earn rate, so a dropped row is money.
  const base = { name: 'Base', minimumAnnualPoints: 0, pointsPerDollar: 10 };
  assert.equal(rewardTiersFrom([]), null);
  assert.equal(rewardTiersFrom('nonsense'), null);
  assert.equal(rewardTiersFrom([base, null]), null);
  assert.equal(rewardTiersFrom([base, { ...base, name: '  ' }]), null);
  assert.equal(rewardTiersFrom([base, { ...base, pointsPerDollar: 0 }]), null);
  assert.equal(rewardTiersFrom([base, { ...base, minimumAnnualPoints: -1 }]), null);
  assert.equal(rewardTiersFrom([base, { ...base, minimumAnnualPoints: 12.5 }]), null);
  // No entry rung: a guest with no points would land on no tier at all.
  assert.equal(rewardTiersFrom([{ ...base, minimumAnnualPoints: 100 }]), null);
});

test('reaches the ladder through a brand config, and only its own', () => {
  assert.deepEqual(
    resolveRewardTiers(coffeeStory)?.map((tier) => tier.name),
    ['First Sip', 'Daily Ritual', 'House Regular', 'Coffee Legend'],
  );
  // The template ships an empty ladder on purpose: a new tenant inherits the
  // generic rungs until its owner writes one.
  assert.equal(resolveRewardTiers(template), null);
  assert.equal(resolveRewardTiers(null), null);
  assert.equal(resolveRewardTiers({ loyalty: null }), null);
  assert.equal(resolveRewardTiers({}), null);
});

test('earns at the tenant rate, not the shipped one', () => {
  const tiers = resolveRewardTiers(coffeeStory) ?? [];
  assert.equal(tierForAnnualPoints(1500, tiers).name, 'House Regular');
  assert.equal(pointsForPurchase(purchase, 1500, tiers), 1500);
});
