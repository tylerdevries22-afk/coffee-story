import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeAppFeeCents, feeMonthKey } from './fees';

const CONFIG = { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 2_000_000 };

describe('computeAppFeeCents', () => {
  it('charges the full rate below the threshold', () => {
    assert.deepEqual(computeAppFeeCents(CONFIG, 0, 10_000), { feeCents: 300, feeBpsApplied: 300 });
  });

  it('charges the tier-2 rate once the month is past the threshold', () => {
    assert.deepEqual(computeAppFeeCents(CONFIG, 2_000_000, 10_000), { feeCents: 150, feeBpsApplied: 150 });
  });

  it('splits a payment that straddles the threshold', () => {
    // $19,990 already processed; a $20 payment: $10 at 3%, $10 at 1.5%.
    const result = computeAppFeeCents(CONFIG, 1_999_000, 2_000);
    assert.equal(result.feeCents, Math.round((1000 * 300 + 1000 * 150) / 10_000)); // 45
    assert.equal(result.feeBpsApplied, 225);
  });

  it('rounds once on the total, not per part', () => {
    // 33 cents at 3% = 0.99 fee-cents below; 33 at 1.5% = 0.495 above.
    // Summed then rounded: 1.485 -> 1. Per-part rounding would give 1 + 0 = 1
    // here but 2 in the mirror case; pin the single-rounding behavior.
    const result = computeAppFeeCents(CONFIG, CONFIG.tierThresholdCents - 33, 66);
    assert.equal(result.feeCents, 1);
  });

  it('fails safe on nonsense payments', () => {
    assert.equal(computeAppFeeCents(CONFIG, 0, 0).feeCents, 0);
    assert.equal(computeAppFeeCents(CONFIG, 0, -500).feeCents, 0);
  });
});

describe('feeMonthKey', () => {
  it('buckets by the location month, not UTC', () => {
    // 2026-09-01T04:30Z is still Aug 31 in Denver.
    assert.equal(feeMonthKey(new Date('2026-09-01T04:30:00Z'), 'America/Denver'), '2026-08');
    assert.equal(feeMonthKey(new Date('2026-09-01T04:30:00Z'), 'UTC'), '2026-09');
  });
});
