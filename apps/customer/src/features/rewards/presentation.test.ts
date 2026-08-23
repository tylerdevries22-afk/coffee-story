import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annualPeriodYear,
  cashDeltaForEntry,
  demoReferralCode,
  referralShareUrl,
  rewardProgress,
} from './presentation';

test('calculates progress within the current reward tier', () => {
  assert.deepEqual(rewardProgress(1641, 1500, 2500), {
    currentFloor: 1500,
    nextThreshold: 2500,
    completed: 141,
    remaining: 859,
    ratio: 0.141,
  });
});

test('clamps reward progress at the tier boundaries', () => {
  assert.equal(rewardProgress(-10, 0, 500).ratio, 0);
  assert.equal(rewardProgress(900, 0, 500).ratio, 1);
});

test('builds an encoded referral share URL', () => {
  assert.equal(
    referralShareUrl('https://coffeestoryco.com/', ' bean 20 '),
    'https://coffeestoryco.com/?ref=BEAN%2020',
  );
  assert.throws(() => referralShareUrl('', 'BEAN20'), RangeError);
});

test('creates a stable demo referral code without exposing punctuation', () => {
  assert.equal(demoReferralCode('demo-client'), 'BEAN-MOCLIENT');
});

test('derives cash value only from cash-credit redemptions', () => {
  assert.equal(cashDeltaForEntry({
    id: 'entry',
    entryType: 'redemption',
    points: -500,
    description: 'Redeemed $5 drink credit',
    earnedAt: '2026-07-29T12:00:00Z',
    expiresAt: null,
  }), 500);
  assert.equal(cashDeltaForEntry({
    id: 'entry',
    entryType: 'purchase',
    points: 100,
    description: 'Spanish Latte',
    earnedAt: '2026-07-29T12:00:00Z',
    expiresAt: null,
  }), null);
});

test('reads annual period years without local-time rollover or NaN output', () => {
  assert.equal(annualPeriodYear('2026-01-01'), 2026);
  assert.equal(annualPeriodYear('not-a-date'), new Date().getUTCFullYear());
});
