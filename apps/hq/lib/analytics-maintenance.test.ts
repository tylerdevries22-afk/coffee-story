import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyticsMaintenanceCutoffs } from './analytics-maintenance';

describe('analyticsMaintenanceCutoffs', () => {
  it('rebuilds 48 hours while retaining raw data 90 days and aggregates 25 months', () => {
    const cutoffs = analyticsMaintenanceCutoffs(new Date('2026-08-27T20:30:00.000Z'));
    assert.equal(cutoffs.rebuildFrom, '2026-08-25T20:30:00.000Z');
    assert.equal(cutoffs.rawBefore, '2026-05-29T20:30:00.000Z');
    assert.equal(cutoffs.hourlyBefore, '2024-07-27T20:30:00.000Z');
    assert.equal(cutoffs.dailyBefore, '2024-07-27');
  });
});
