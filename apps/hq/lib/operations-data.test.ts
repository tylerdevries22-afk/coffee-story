import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OperationsWorkspace } from './operations-data';
import { scopeWorkspaceToLocation } from './operations-workspace-scope';

function workspace(): OperationsWorkspace {
  const occurrence = (id: string, locationId: string, status: 'completed' | 'missed') => ({
    id, locationId, locationName: locationId, title: id,
    status, persistedStatus: status,
    scheduledFor: '2026-08-31T10:00:00.000Z', dueAt: '2026-08-31T10:30:00.000Z',
    graceMinutes: 10, claimedBy: null,
    completedAt: status === 'completed' ? '2026-08-31T10:20:00.000Z' : null,
    completionNote: '',
  });
  return {
    enabled: true,
    canEditBrandDefaults: true,
    locations: [
      { id: 'store-a', name: 'Store A', timezone: 'America/Denver' },
      { id: 'store-b', name: 'Store B', timezone: 'America/Denver' },
    ],
    templates: [],
    schedules: [],
    occurrences: [
      occurrence('occurrence-a', 'store-a', 'completed'),
      occurrence('occurrence-b', 'store-b', 'missed'),
    ],
    issues: [
      { id: 'issue-a', occurrenceId: 'occurrence-a', category: 'equipment',
        severity: 'normal', status: 'open', createdAt: '2026-08-31T10:00:00.000Z' },
      { id: 'issue-b', occurrenceId: 'occurrence-b', category: 'safety',
        severity: 'urgent', status: 'open', createdAt: '2026-08-31T10:00:00.000Z' },
    ],
    metrics: { accountable: 0, completed: 0, completedOnTime: 0, overdue: 0, missed: 0,
      completionRate: null, onTimeRate: null, overdueRate: null },
    retention: { evidenceDays: 365, issueDays: 730, actorIdentityDays: 365 },
  };
}

describe('scopeWorkspaceToLocation', () => {
  it('keeps only occurrences and issues belonging to the selected store', () => {
    const scoped = scopeWorkspaceToLocation(workspace(), 'store-a');
    assert.deepEqual(scoped.occurrences.map((row) => row.id), ['occurrence-a']);
    assert.deepEqual(scoped.issues.map((row) => row.id), ['issue-a']);
    assert.equal(scoped.metrics.accountable, 1);
    assert.equal(scoped.metrics.completedOnTime, 1);
  });

  it('keeps the brand-wide workspace when no store is selected', () => {
    const original = workspace();
    assert.equal(scopeWorkspaceToLocation(original, null), original);
  });
});
