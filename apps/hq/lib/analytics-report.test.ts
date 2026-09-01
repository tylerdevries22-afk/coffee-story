import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyticsReportOf } from './analytics-report';
import { DEMO_KPIS } from './demo-data';

describe('analyticsReportOf', () => {
  it('aggregates locations into one ordered daily revenue trend', () => {
    const report = analyticsReportOf('overview', DEMO_KPIS, []);
    assert.equal(report.points.length, 7);
    assert.equal(report.points[0]?.day, '2026-08-16');
    assert.equal(report.points[0]?.value, 148_500);
    assert.equal(report.points.at(-1)?.formattedValue, '$2,259.00');
    assert.equal(report.rangeLabel, 'Aug 16, 2026 – Aug 22, 2026');
  });

  it('uses only the requested telemetry signal', () => {
    const report = analyticsReportOf('apps', [], [
      { day: '2026-08-20', surface: 'customer', metricKey: 'session.started', eventCount: 4, successCount: 4, failureCount: 0, durationP50Ms: null, durationP95Ms: null },
      { day: '2026-08-20', surface: 'hq', metricKey: 'session.started', eventCount: 3, successCount: 3, failureCount: 0, durationP50Ms: null, durationP95Ms: null },
      { day: '2026-08-20', surface: 'hq', metricKey: 'error.occurred', eventCount: 8, successCount: 0, failureCount: 8, durationP50Ms: null, durationP95Ms: null },
    ]);
    assert.equal(report.points[0]?.value, 7);
  });

  it('keeps unavailable time series explicit', () => {
    const report = analyticsReportOf('training', DEMO_KPIS, []);
    assert.equal(report.points.length, 0);
    assert.equal(report.rangeLabel, 'No complete window');
    assert.match(report.deltaLabel, /Awaiting/);
  });
});
