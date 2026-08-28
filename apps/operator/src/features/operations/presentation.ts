import {
  operationDisplayStatus,
  type ChecklistStep,
  type OperationDisplayStatus,
  type OperationOccurrence,
  type OperationStatus,
} from '@platform/domain';
import type { OperationOccurrenceRow } from '@platform/schema';

export type OperationChecklistStep = ChecklistStep & {
  title: string;
  instructions: string;
};

export type OperationQueueItem = {
  row: OperationOccurrenceRow;
  title: string;
  displayStatus: OperationDisplayStatus;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stepFrom(value: unknown): OperationChecklistStep | null {
  const row = record(value);
  if (!row || typeof row.key !== 'string' || typeof row.title !== 'string'
    || !['confirm', 'pass_fail', 'number', 'text'].includes(String(row.responseKind))) return null;
  const constraints = record(row.constraints);
  return {
    key: row.key,
    title: row.title,
    instructions: typeof row.instructions === 'string' ? row.instructions : '',
    responseKind: row.responseKind as OperationChecklistStep['responseKind'],
    required: row.required !== false,
    issueOnFailure: row.issueOnFailure === true,
    minimum: finiteNumber(row.minimum) ?? finiteNumber(constraints?.minimum),
    maximum: finiteNumber(row.maximum) ?? finiteNumber(constraints?.maximum),
    maxLength: finiteNumber(row.maxLength) ?? finiteNumber(constraints?.maxLength),
  };
}

export function operationTitle(row: OperationOccurrenceRow): string {
  const snapshot = record(row.template_snapshot);
  const title = snapshot?.title;
  return typeof title === 'string' && title.trim() ? title : 'Operation';
}

export function operationChecklist(row: OperationOccurrenceRow): OperationChecklistStep[] {
  const steps = record(row.template_snapshot)?.steps;
  return Array.isArray(steps)
    ? steps.map(stepFrom).filter((step): step is OperationChecklistStep => step !== null)
    : [];
}

export function operationQueueItems(
  rows: readonly OperationOccurrenceRow[],
  now: Date,
): OperationQueueItem[] {
  const rank: Readonly<Record<OperationDisplayStatus, number>> = {
    overdue: 0, claimed: 1, scheduled: 2, missed: 3, completed: 4, cancelled: 5,
  };
  return rows.map((row) => ({
    row,
    title: operationTitle(row),
    displayStatus: operationDisplayStatus({
      id: row.id, status: normalizedStatus(row.status), scheduledFor: row.scheduled_for, dueAt: row.due_at,
      graceMinutes: row.grace_minutes, claimedBy: row.claimed_by,
      claimedAt: row.claimed_at, claimExpiresAt: row.claim_expires_at, completedAt: row.completed_at,
    } satisfies OperationOccurrence, now),
  })).sort((left, right) => rank[left.displayStatus] - rank[right.displayStatus]
    || Date.parse(left.row.scheduled_for) - Date.parse(right.row.scheduled_for));
}

function normalizedStatus(value: OperationOccurrenceRow['status']): OperationStatus {
  if (value === 'claimed' || value === 'completed' || value === 'cancelled') return value;
  if (String(value) === 'missed') return 'missed';
  return 'scheduled';
}
