import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyticsRollupsOf, scopeAnalyticsRollups } from './analytics-rollups';

describe('analyticsRollupsOf', () => {
  it('normalizes PostgREST numerics without changing tenant-safe dimensions', () => {
    const [rollup] = analyticsRollupsOf([{
      day: '2026-08-27', surface: 'kiosk', metric_key: 'session.started',
      event_count: '12', success_count: 10, failure_count: '2',
      duration_p50_ms: null, duration_p95_ms: 350,
    }]);
    assert.deepEqual(rollup, {
      day: '2026-08-27', surface: 'kiosk', metricKey: 'session.started',
      eventCount: 12, successCount: 10, failureCount: 2,
      durationP50Ms: null, durationP95Ms: 350,
    });
  });
});

describe('scopeAnalyticsRollups', () => {
  it('filters telemetry to the selected tenant and location', () => {
    const filters: [string, string][] = [];
    const query = {
      eq(column: string, value: string) {
        filters.push([column, value]);
        return query;
      },
    };

    assert.equal(scopeAnalyticsRollups(query, 'brand-1', 'location-1'), query);
    assert.deepEqual(filters, [
      ['brand_id', 'brand-1'],
      ['location_id', 'location-1'],
    ]);
  });

  it('keeps all tenant locations when no location is selected', () => {
    const filters: [string, string][] = [];
    const query = {
      eq(column: string, value: string) {
        filters.push([column, value]);
        return query;
      },
    };

    scopeAnalyticsRollups(query, 'brand-1', null);
    assert.deepEqual(filters, [['brand_id', 'brand-1']]);
  });
});
