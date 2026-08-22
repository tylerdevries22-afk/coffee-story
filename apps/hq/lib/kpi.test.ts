import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { KpiDay } from './demo-data';
import { formatMoney, formatShare, rollupByLocation, rollupKpis } from './kpi';

const day = (locationId: string, revenueCents: number, ordersCount: number, inAppShare: number, loyalty: number): KpiDay => ({
  day: '2026-08-22', locationId, locationName: locationId.toUpperCase(),
  ordersCount, revenueCents, aovCents: ordersCount ? Math.round(revenueCents / ordersCount) : 0,
  inAppShare, loyaltyRedemptionRate: loyalty,
});

describe('rollupKpis', () => {
  it('sums money and orders, derives AOV from the sums', () => {
    const totals = rollupKpis([day('a', 100_000, 100, 0.5, 0.2), day('b', 50_000, 25, 0.8, 0.4)]);
    assert.equal(totals.revenueCents, 150_000);
    assert.equal(totals.ordersCount, 125);
    assert.equal(totals.aovCents, 1200);
  });

  it('weights shares by what they describe: revenue for in-app, orders for loyalty', () => {
    const totals = rollupKpis([day('a', 100_000, 100, 0.5, 0.2), day('b', 50_000, 25, 0.8, 0.4)]);
    assert.ok(Math.abs(totals.inAppShare - 0.6) < 1e-9);       // (0.5*100k + 0.8*50k)/150k
    assert.ok(Math.abs(totals.loyaltyRedemptionRate - 0.24) < 1e-9); // (0.2*100 + 0.4*25)/125
  });

  it('handles an empty range without dividing by zero', () => {
    const totals = rollupKpis([]);
    assert.equal(totals.aovCents, 0);
    assert.equal(totals.inAppShare, 0);
  });
});

describe('rollupByLocation', () => {
  it('ranks locations by revenue', () => {
    const rows = rollupByLocation([day('small', 10_000, 10, 0.5, 0.1), day('big', 90_000, 60, 0.6, 0.2)]);
    assert.deepEqual(rows.map((row) => row.locationId), ['big', 'small']);
  });
});

describe('formatting', () => {
  it('prints money with separators and shares with one decimal', () => {
    assert.equal(formatMoney(2_612_400), '$26,124.00');
    assert.equal(formatShare(0.583), '58.3%');
  });
});
