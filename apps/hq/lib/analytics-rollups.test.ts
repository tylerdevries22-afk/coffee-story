import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyticsRollupsOf } from './analytics-rollups';

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
