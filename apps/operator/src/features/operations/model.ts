import {
  operationDisplayStatus,
  type OperationDisplayStatus,
  type OperationOccurrence,
  type OperationResponseKind,
  type OperationStatus,
} from '@platform/domain';

export type OperatorChecklistStep = {
  key: string;
  title: string;
  instructions: string;
  responseKind: OperationResponseKind;
  required: boolean;
  issueOnFailure: boolean;
  allowNotApplicable?: boolean;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
};

export type OperatorTaskSnapshot = {
  templateId: string;
  templateKey: string;
  revision: number;
  title: string;
  instructions: string;
  estimatedMinutes: number;
  requiredRoleIds: readonly string[];
  requiredCompetencyKeys: readonly string[];
  issueCategories: readonly string[];
  steps: readonly OperatorChecklistStep[];
};

export type OperatorEligibility = {
  eligible: boolean;
  hasActiveShift: boolean;
  missingRoles: readonly string[];
  missingCompetencies: readonly string[];
};

export type OperatorTaskOccurrence = OperationOccurrence & {
  brandId: string;
  locationId: string;
  snapshot: OperatorTaskSnapshot;
  eligibility: OperatorEligibility;
  completedBy: string | null;
  completionNote: string;
};

export type OperatorTaskIssue = {
  id: string;
  occurrenceId: string;
  category: string;
  severity: 'low' | 'normal' | 'high' | 'urgent';
  description: string;
  stepKey: string | null;
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
};

export type OperatorNotification = {
  id: string;
  occurrenceId: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type OperatorQueueSnapshot = {
  occurrences: readonly OperatorTaskOccurrence[];
  issues: readonly OperatorTaskIssue[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATION_STATUSES: readonly OperationStatus[] = [
  'scheduled', 'claimed', 'completed', 'missed', 'cancelled',
];
const RESPONSE_KINDS: readonly OperationResponseKind[] = ['confirm', 'pass_fail', 'number', 'text'];

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
    ? row.responseKind as OperationResponseKind
    : 'confirm';
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
    templateId: row.templateId,
    templateKey: text(row.templateKey),
    revision: finiteNumber(row.revision, 1),
    title: row.title,
    instructions: text(row.instructions),
    estimatedMinutes: finiteNumber(row.estimatedMinutes, 10),
    requiredRoleIds: stringList(row.requiredRoleIds),
    requiredCompetencyKeys: stringList(row.requiredCompetencyKeys),
    issueCategories: stringList(row.issueCategories),
    steps,
  };
}

function parseEligibility(value: unknown): OperatorEligibility {
  const row = objectRecord(value);
  if (!row) return { eligible: false, hasActiveShift: false, missingRoles: [], missingCompetencies: [] };
  return {
    eligible: row.eligible === true,
    hasActiveShift: row.hasActiveShift === true,
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
    ? statusValue as OperationStatus
    : null;
  const snapshot = parseSnapshot(row.snapshot ?? row.templateSnapshot ?? row.template_snapshot);
  if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(brandId) || !UUID_PATTERN.test(locationId)
    || !status || !Number.isFinite(Date.parse(scheduledFor)) || !Number.isFinite(Date.parse(dueAt))
    || !snapshot) return null;
  return {
    id,
    brandId,
    locationId,
    status,
    scheduledFor,
    dueAt,
    graceMinutes: finiteNumber(row.graceMinutes ?? row.grace_minutes, 0),
    claimedBy: optionalText(row.claimedBy ?? row.claimed_by),
    claimedAt: optionalText(row.claimedAt ?? row.claimed_at),
    claimExpiresAt: optionalText(row.claimExpiresAt ?? row.claim_expires_at),
    completedAt: optionalText(row.completedAt ?? row.completed_at),
    completedBy: optionalText(row.completedBy ?? row.completed_by),
    completionNote: text(row.completionNote ?? row.completion_note),
    snapshot,
    eligibility: parseEligibility(row.eligibility),
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
    id: row.id,
    occurrenceId: String(row.occurrenceId ?? row.occurrence_id),
    category: text(row.category),
    severity: severity as OperatorTaskIssue['severity'],
    description: text(row.description),
    stepKey: optionalText(row.stepKey ?? row.step_key),
    status: status as OperatorTaskIssue['status'],
  };
}

/** Validates the untrusted queue response before it reaches operator UI state. */
export function parseOperatorQueue(value: unknown): OperatorQueueSnapshot {
  const row = objectRecord(value);
  const occurrenceSource = Array.isArray(row?.occurrences)
    ? row.occurrences
    : Array.isArray(row?.items) ? row.items : [];
  const issueSource = Array.isArray(row?.issues) ? row.issues : [];
  return {
    occurrences: occurrenceSource.map(parseOccurrence)
      .filter((item): item is OperatorTaskOccurrence => item !== null),
    issues: issueSource.map(parseIssue).filter((item): item is OperatorTaskIssue => item !== null),
  };
}

export function displayStatusForTask(task: OperatorTaskOccurrence, now: Date): OperationDisplayStatus {
  return operationDisplayStatus(task, now);
}

export function taskIsActionable(task: OperatorTaskOccurrence, now: Date): boolean {
  const status = displayStatusForTask(task, now);
  return task.eligibility.eligible
    && now.getTime() >= Date.parse(task.scheduledFor)
    && ['scheduled', 'claimed', 'overdue'].includes(status);
}

export function taskEligibilityMessage(task: OperatorTaskOccurrence): string | null {
  if (!task.eligibility.hasActiveShift) return 'You need an active shift before claiming this task.';
  if (task.eligibility.missingCompetencies.length > 0) {
    return `Training required: ${task.eligibility.missingCompetencies.join(', ')}`;
  }
  if (task.eligibility.missingRoles.length > 0) {
    return `Assigned role required: ${task.eligibility.missingRoles.join(', ')}`;
  }
  return task.eligibility.eligible ? null : 'You are not eligible to claim this task.';
}

export function operationCalendarId(occurrenceId: string): string {
  return `operation-${occurrenceId}`;
}

export function occurrenceIdFromCalendarId(itemId: string): string | null {
  const id = itemId.startsWith('operation-') ? itemId.slice('operation-'.length) : '';
  return UUID_PATTERN.test(id) ? id : null;
}
