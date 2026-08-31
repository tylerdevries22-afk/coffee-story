import { operationMetrics } from '@platform/domain';

import { scopeRowsToLocation } from './location-scope';
import type { OperationsWorkspace } from './operations-data';

/** Keeps per-store operations, issues, and derived metrics on one location. */
export function scopeWorkspaceToLocation(
  workspace: OperationsWorkspace,
  locationId: string | null,
): OperationsWorkspace {
  if (!locationId) return workspace;
  const occurrences = scopeRowsToLocation(workspace.occurrences, locationId);
  const occurrenceIds = new Set(occurrences.map((row) => row.id));
  return {
    ...workspace,
    occurrences,
    schedules: scopeRowsToLocation(workspace.schedules, locationId),
    issues: workspace.issues.filter((issue) => occurrenceIds.has(issue.occurrenceId)),
    metrics: operationMetrics(occurrences.map((row) => ({
      id: row.id,
      status: row.persistedStatus,
      scheduledFor: row.scheduledFor,
      dueAt: row.dueAt,
      graceMinutes: row.graceMinutes,
      claimedBy: row.claimedBy,
      completedAt: row.completedAt,
    }))),
  };
}
