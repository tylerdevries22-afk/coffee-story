import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextRewardForBalance, rewardFillPercent, rewardIsLocked } from './redeem';

const catalog = [
  { id: 'expensive', name: 'Large', description: null, pointsCost: 1500, active: true },
  { id: 'small', name: 'Small', description: null, pointsCost: 500, active: true },
] as const;

test('the next reward is the cheapest reward still above the balance', () => {
  assert.equal(nextRewardForBalance(catalog, 100)?.id, 'small');
  assert.equal(nextRewardForBalance(catalog, 500)?.id, 'expensive');
  assert.equal(nextRewardForBalance(catalog, 1500), undefined);
});

test('reward progress is clamped at both ends', () => {
  assert.equal(rewardFillPercent(-5, 500), 0);
  assert.equal(rewardFillPercent(250, 500), 0.5);
  assert.equal(rewardFillPercent(700, 500), 1);
  assert.equal(rewardFillPercent(10, 0), 1);
});

test('a reward is locked only when its cost exceeds the balance', () => {
  assert.equal(rewardIsLocked(catalog[0], 1499), true);
  assert.equal(rewardIsLocked(catalog[0], 1500), false);
});
