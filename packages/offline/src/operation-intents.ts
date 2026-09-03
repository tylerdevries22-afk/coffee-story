/** Offline operations actions. The caller owns UUID and clock generation. */
export const OPERATION_INTENT_VERSION = 1 as const;

export type OperationNotApplicableResponse = { state: 'not_applicable'; reason: string };
export type OperationIntentResponse = boolean | number | string | OperationNotApplicableResponse;
export type OperationIssueSeverity = 'low' | 'normal' | 'high' | 'urgent';

type OperationIntentBase = {
  version: typeof OPERATION_INTENT_VERSION;
  actionId: string;
  brandId: string;
  locationId: string;
  occurrenceId: string;
  createdAt: string;
};

export type ClaimOperationIntent = OperationIntentBase & {
  kind: 'claim';
};

export type CompleteOperationIntent = OperationIntentBase & {
  kind: 'complete';
  claimActionId: string | null;
  responses: Readonly<Record<string, OperationIntentResponse>>;
  note: string;
  issues: readonly OperationIntentIssue[];
};

export type OperationIntentIssue = {
  category: string;
  severity: OperationIssueSeverity;
  description: string;
  stepKey: string | null;
};

export type ReportIssueOperationIntent = OperationIntentBase & {
  kind: 'report_issue';
  category: string;
  severity: OperationIssueSeverity;
  description: string;
  stepKey: string | null;
};

export type CancelOperationIntent = OperationIntentBase & {
  kind: 'cancel';
  reason: string;
};

export type ReleaseOperationIntent = OperationIntentBase & {
  kind: 'release';
};

export type OperationIntent = ClaimOperationIntent | CompleteOperationIntent
  | ReportIssueOperationIntent | ReleaseOperationIntent | CancelOperationIntent;

export type PermanentOperationIntentConflict = {
  code: string;
  message: string;
  recordedAt: string;
};

export type OperationIntentRecord =
  | { status: 'pending'; intent: OperationIntent }
  | { status: 'conflict'; intent: OperationIntent; conflict: PermanentOperationIntentConflict };

export type OperationIntentQueue = {
  brandId: string;
  locationId: string;
  records: readonly OperationIntentRecord[];
};

// Exported only so the queue module beside this one can reuse the exact same
// pattern; deliberately absent from the package barrel.
export const INTENT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ISSUE_SEVERITIES: readonly OperationIssueSeverity[] = ['low', 'normal', 'high', 'urgent'];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validBase(value: Record<string, unknown>): boolean {
  return value.version === OPERATION_INTENT_VERSION
    && [value.actionId, value.brandId, value.locationId, value.occurrenceId]
      .every((id) => typeof id === 'string' && INTENT_UUID_PATTERN.test(id))
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt));
}

function validResponse(value: unknown): boolean {
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  const response = record(value);
  return response?.state === 'not_applicable' && typeof response.reason === 'string'
    && response.reason.trim().length >= 3 && response.reason.length <= 500;
}

function validResponses(value: unknown): boolean {
  const responses = record(value);
  return responses !== null && Object.values(responses).every(validResponse);
}

function validIssue(value: unknown): value is OperationIntentIssue {
  const issue = record(value);
  return issue !== null
    && typeof issue.category === 'string' && issue.category.trim().length > 0
    && ISSUE_SEVERITIES.includes(issue.severity as OperationIssueSeverity)
    && typeof issue.description === 'string' && issue.description.trim().length > 0
    && (issue.stepKey === null || typeof issue.stepKey === 'string');
}

/** Runtime boundary for data rehydrated from SecureStore. */
export function isOperationIntent(value: unknown): value is OperationIntent {
  const candidate = record(value);
  if (!candidate || !validBase(candidate)) return false;
  if (candidate.kind === 'claim') return true;
  if (candidate.kind === 'complete') {
    return (candidate.claimActionId === null
      || (typeof candidate.claimActionId === 'string' && INTENT_UUID_PATTERN.test(candidate.claimActionId)))
      && validResponses(candidate.responses) && typeof candidate.note === 'string'
      && Array.isArray(candidate.issues) && candidate.issues.every(validIssue);
  }
  if (candidate.kind === 'report_issue') {
    return typeof candidate.category === 'string' && candidate.category.trim().length > 0
      && ISSUE_SEVERITIES.includes(candidate.severity as OperationIssueSeverity)
      && typeof candidate.description === 'string'
      && (candidate.stepKey === null || typeof candidate.stepKey === 'string');
  }
  if (candidate.kind === 'release') return true;
  return candidate.kind === 'cancel'
    && typeof candidate.reason === 'string' && candidate.reason.trim().length > 0;
}
