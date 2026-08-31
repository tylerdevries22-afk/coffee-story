import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  operationReportCsv,
  operationReportFilters,
  operationReportLocationId,
} from './operations-report';

describe('operationReportLocationId', () => {
  it('inherits workspace scope unless the report names a location', () => {
    assert.equal(operationReportLocationId(null, 'workspace-location'), 'workspace-location');
    assert.equal(operationReportLocationId('report-location', 'workspace-location'), 'report-location');
    assert.equal(operationReportLocationId(null, null), null);
  });
});

describe('operationReportFilters', () => {
  it('uses a bounded default window and accepts supported filters', () => {
    const now = new Date('2026-08-27T12:00:00.000Z');
    assert.deepEqual(operationReportFilters(new URLSearchParams(
      'status=completed&locationId=11111111-1111-4111-8111-111111111111&issueType=supply',
    ), now), {
      from: '2026-07-27T12:00:00.000Z',
      to: now.toISOString(),
      locationId: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      issueType: 'supply',
    });
  });

  it('rejects invalid statuses and unbounded report windows', () => {
    assert.equal(operationReportFilters(new URLSearchParams('status=overdue')), null);
    assert.equal(operationReportFilters(new URLSearchParams(
      'from=2024-01-01T00%3A00%3A00Z&to=2026-01-01T00%3A00%3A00Z',
    )), null);
  });
});

describe('operationReportCsv', () => {
  it('exports immutable occurrence fields and safely quotes tenant text', () => {
    const csv = operationReportCsv([{
      occurrenceId: 'occurrence-1', locationName: 'Main, Street', program: 'Guest Restroom',
      routine: 'Closing', status: 'completed', scheduledFor: '2026-08-27T01:00:00Z',
      dueAt: '2026-08-27T01:30:00Z', completedAt: '2026-08-27T01:20:00Z',
      issueTypes: ['supply', 'fixture'],
    }]);
    assert.match(csv, /"Main, Street"/);
    assert.match(csv, /supply\|fixture/);
  });
});
