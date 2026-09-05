import type { OperationResponseKind, OperationStatus } from '@platform/domain';

import type {
  OperatorChecklistStep, OperatorEligibility, OperatorNotification,
  OperatorQueueSnapshot, OperatorTaskIssue, OperatorTaskOccurrence,
  OperatorTaskSnapshot,
} from './model-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATION_STATUSES: readonly OperationStatus[] = [
  'scheduled', 'claimed', 'completed', 'missed', 'cancelled',
];
const RESPONSE_KINDS: readonly OperationResponseKind[] = ['confirm', 'pass_fail', 'number', 'text'];

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseStep(value: unknown): OperatorChecklistStep | null {
  const row = objectRecord(value);
  if (!row || typeof row.key !== 'string' || !row.key.trim()) return null;
  const responseKind = RESPONSE_KINDS.includes(row.responseKind as OperationResponseKind)
    ? row.responseKind as OperationResponseKind : 'confirm';
  const constraints = objectRecord(row.constraints) ?? row;
  const step: OperatorChecklistStep = {
    key: row.key,
    title: text(row.title, row.key.replaceAll('-', ' ')),
    instructions: text(row.instructions),
    responseKind,
    required: row.required !== false,
    issueOnFailure: row.issueOnFailure === true,
    allowNotApplicable: row.allowNotApplicable === true,
  };
  if (typeof constraints.minimum === 'number') step.minimum = constraints.minimum;
  if (typeof constraints.maximum === 'number') step.maximum = constraints.maximum;
  if (typeof constraints.maxLength === 'number') step.maxLength = constraints.maxLength;
  return step;
}

function parseSnapshot(value: unknown): OperatorTaskSnapshot | null {
  const row = objectRecord(value);
  if (!row || typeof row.templateId !== 'string' || typeof row.title !== 'string'
    || !Array.isArray(row.steps)) return null;
  const steps = row.steps.map(parseStep).filter((step): step is OperatorChecklistStep => step !== null);
  return {
    templateId: row.templateId, templateKey: text(row.templateKey),
    revision: finiteNumber(row.revision, 1), title: row.title,
    instructions: text(row.instructions), estimatedMinutes: finiteNumber(row.estimatedMinutes, 10),
    requiredRoleIds: stringList(row.requiredRoleIds),
    requiredRoleLabels: stringList(row.requiredRoleLabels),
    requiredCompetencyKeys: stringList(row.requiredCompetencyKeys),
    issueCategories: stringList(row.issueCategories), steps,
  };
}

function parseEligibility(value: unknown): OperatorEligibility {
  const row = objectRecord(value);
  if (!row) return { eligible: false, hasActiveShift: false, missingRoles: [], missingCompetencies: [] };
  return {
    eligible: row.eligible === true, hasActiveShift: row.hasActiveShift === true,
    missingRoles: stringList(row.missingRoles),
    missingCompetencies: stringList(row.missingCompetencies),
  };
}

function parseOccurrence(value: unknown): OperatorTaskOccurrence | null {
  const row = objectRecord(value);
  if (!row) return null;
  const id = text(row.id);
  const brandId = text(row.brandId ?? row.brand_id);
  const locationId = text(row.locationId ?? row.location_id);
  const scheduledFor = text(row.scheduledFor ?? row.scheduled_for);
  const dueAt = text(row.dueAt ?? row.due_at);
  const statusValue = row.status;
  const status = OPERATION_STATUSES.includes(statusValue as OperationStatus)
    ? statusValue as OperationStatus : null;
  const snapshot = parseSnapshot(row.snapshot ?? row.templateSnapshot ?? row.template_snapshot);
  if (!isOperationId(id) || !isOperationId(brandId) || !isOperationId(locationId)
    || !status || !Number.isFinite(Date.parse(scheduledFor)) || !Number.isFinite(Date.parse(dueAt))
    || !snapshot) return null;
  return {
    id, brandId, locationId, status, scheduledFor, dueAt,
    graceMinutes: finiteNumber(row.graceMinutes ?? row.grace_minutes, 0),
    claimedBy: optionalText(row.claimedBy ?? row.claimed_by),
    claimedAt: optionalText(row.claimedAt ?? row.claimed_at),
    claimExpiresAt: optionalText(row.claimExpiresAt ?? row.claim_expires_at),
    completedAt: optionalText(row.completedAt ?? row.completed_at),
    completedBy: optionalText(row.completedBy ?? row.completed_by),
    completionNote: text(row.completionNote ?? row.completion_note),
    actorName: optionalText(row.actorName ?? row.actor_name),
    snapshot, eligibility: parseEligibility(row.eligibility),
  };
}

function parseIssue(value: unknown): OperatorTaskIssue | null {
  const row = objectRecord(value);
  if (!row) return null;
  const severity = row.severity;
  const status = row.status;
  if (typeof row.id !== 'string' || typeof (row.occurrenceId ?? row.occurrence_id) !== 'string'
    || !['low', 'normal', 'high', 'urgent'].includes(String(severity))
    || !['open', 'acknowledged', 'resolved', 'dismissed'].includes(String(status))) return null;
  return {
    id: row.id, occurrenceId: String(row.occurrenceId ?? row.occurrence_id),
    category: text(row.category), severity: severity as OperatorTaskIssue['severity'],
    description: text(row.description), stepKey: optionalText(row.stepKey ?? row.step_key),
    status: status as OperatorTaskIssue['status'],
  };
}

export function isOperationId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Validates the untrusted queue response before it reaches operator UI state. */
export function parseOperatorQueue(value: unknown): OperatorQueueSnapshot {
  const row = objectRecord(value);
  const occurrenceSource = Array.isArray(row?.occurrences)
    ? row.occurrences : Array.isArray(row?.items) ? row.items : [];
  const issueSource = Array.isArray(row?.issues) ? row.issues : [];
  return {
    occurrences: occurrenceSource.map(parseOccurrence)
      .filter((item): item is OperatorTaskOccurrence => item !== null),
    issues: issueSource.map(parseIssue).filter((item): item is OperatorTaskIssue => item !== null),
  };
}

function parseNotification(value: unknown): OperatorNotification | null {
  const row = objectRecord(value);
  if (!row) return null;
  const occurrenceId = 'occurrenceId' in row ? row.occurrenceId : row.occurrence_id;
  const createdAt = row.createdAt ?? row.created_at;
  const readAt = row.readAt ?? row.read_at;
  if (typeof row.id !== 'string' || (occurrenceId !== null && typeof occurrenceId !== 'string')
    || typeof row.title !== 'string' || typeof row.body !== 'string'
    || typeof createdAt !== 'string') return null;
  return {
    id: row.id, occurrenceId, title: row.title, body: row.body, createdAt,
    readAt: typeof readAt === 'string' ? readAt : null,
  };
}

/** Validates persisted notifications while preserving system rows without a deep link. */
export function parseOperatorNotifications(value: unknown): readonly OperatorNotification[] {
  const row = objectRecord(value);
  const notifications = Array.isArray(row?.notifications) ? row.notifications : [];
  return notifications.map(parseNotification)
    .filter((item): item is OperatorNotification => item !== null);
}
