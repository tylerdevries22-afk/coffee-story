import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computeAppFeeCents, feeMonthKey, feeMonthRange, resolveFeeConfig } from './fees';

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

describe('feeMonthRange', () => {
  it('covers the location’s own month, not UTC’s', () => {
    // Denver is UTC-6 in August, so its August starts at 06:00 UTC on the 1st.
    const { startIso, endIso } = feeMonthRange(new Date('2026-08-15T12:00:00Z'), 'America/Denver');
    assert.equal(startIso, '2026-08-01T06:00:00.000Z');
    assert.equal(endIso, '2026-09-01T06:00:00.000Z');
  });

  it('does not sweep the previous evening into the new month', () => {
    // 11pm on July 31 in Denver is 05:00 UTC on August 1: a busy close that
    // the old bare-date filter counted as August gross.
    const { startIso } = feeMonthRange(new Date('2026-08-15T12:00:00Z'), 'America/Denver');
    assert.ok(new Date('2026-08-01T05:00:00Z') < new Date(startIso), 'July’s close stays in July');
  });

  it('handles a zone ahead of UTC, where the old filter dropped real payments', () => {
    // Tokyo is UTC+9: its August began at 15:00 UTC on July 31.
    const { startIso, endIso } = feeMonthRange(new Date('2026-08-15T12:00:00Z'), 'Asia/Tokyo');
    assert.equal(startIso, '2026-07-31T15:00:00.000Z');
    assert.equal(endIso, '2026-08-31T15:00:00.000Z');
  });

  it('rolls December into the next year', () => {
    const { startIso, endIso } = feeMonthRange(new Date('2026-12-10T12:00:00Z'), 'America/Denver');
    assert.equal(startIso, '2026-12-01T07:00:00.000Z');
    assert.equal(endIso, '2027-01-01T07:00:00.000Z');
  });

  it('is exact for UTC itself', () => {
    const { startIso, endIso } = feeMonthRange(new Date('2026-08-15T12:00:00Z'), 'UTC');
    assert.equal(startIso, '2026-08-01T00:00:00.000Z');
    assert.equal(endIso, '2026-09-01T00:00:00.000Z');
  });
});

/**
 * A franchise does not have one fee schedule.
 *
 * Rule 3 put the take on the brand, which is right for a shop and wrong the
 * moment the brand carries franchisees on separately negotiated terms. These
 * pin the inheritance, because the failure mode is silent money: a location
 * that should be billing 250bps quietly billing 300 looks like nothing at all
 * until a franchisee reconciles an invoice.
 */
describe('resolveFeeConfig', () => {
  const brand = { fee_bps: 300, fee_bps_tier2: 150, tier_threshold_cents: 2_000_000 };

  it('uses the brand when the location negotiated nothing', () => {
    assert.deepEqual(resolveFeeConfig(brand, null), {
      feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 2_000_000,
    });
    assert.deepEqual(resolveFeeConfig(brand, {}), {
      feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 2_000_000,
    });
  });

  it('overrides field by field, not wholesale', () => {
    // The point of per-field: a franchisee who negotiated a rate but not a
    // threshold still moves with the brand when the threshold changes. A
    // wholesale override would freeze them at whatever the brand happened to
    // be on the day they signed.
    const config = resolveFeeConfig(brand, { fee_bps: 250 });
    assert.equal(config.feeBps, 250, 'the negotiated rate wins');
    assert.equal(config.feeBpsTier2, 150, 'the rest still follow the brand');
    assert.equal(config.tierThresholdCents, 2_000_000);
  });

  it('honours a zero override rather than treating it as absent', () => {
    // A location on a free trial is exactly 0, and `||` would have read that
    // as "unset" and billed them the brand rate.
    assert.equal(resolveFeeConfig(brand, { fee_bps: 0 }).feeBps, 0);
  });

  it('falls back rather than propagating a malformed value', () => {
    for (const bad of [Number.NaN, undefined, null]) {
      assert.equal(
        resolveFeeConfig(brand, { fee_bps: bad as number | null | undefined }).feeBps,
        300,
        `${String(bad)} must not reach a fee calculation`,
      );
    }
  });

  it('produces a config computeAppFeeCents can charge against', () => {
    const config = resolveFeeConfig(brand, { fee_bps: 250 });
    const { feeCents } = computeAppFeeCents(config, 0, 10_000);
    assert.equal(feeCents, 250, '250bps of $100 is $2.50');
  });
});
