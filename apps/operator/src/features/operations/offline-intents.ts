/** Offline operations actions. The caller owns UUID and clock generation. */
export const OPERATION_INTENT_VERSION = 1 as const;

export type OperationIntentResponse = boolean | number | string;
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISSUE_SEVERITIES: readonly OperationIssueSeverity[] = ['low', 'normal', 'high', 'urgent'];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validBase(value: Record<string, unknown>): boolean {
  return value.version === OPERATION_INTENT_VERSION
    && [value.actionId, value.brandId, value.locationId, value.occurrenceId]
      .every((id) => typeof id === 'string' && UUID_PATTERN.test(id))
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt));
}

function validResponses(value: unknown): boolean {
  const responses = record(value);
  return responses !== null && Object.values(responses).every((response) => (
    typeof response === 'boolean'
    || typeof response === 'string'
    || (typeof response === 'number' && Number.isFinite(response))
  ));
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
      || (typeof candidate.claimActionId === 'string' && UUID_PATTERN.test(candidate.claimActionId)))
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

/** Confirms one action while preserving later work that depended on its claim. */
export function confirmOperationIntent(
  queue: OperationIntentQueue,
  actionId: string,
): OperationIntentQueue {
  const target = queue.records.find((entry) => entry.intent.actionId === actionId);
  if (!target) return queue;
  const records = queue.records.flatMap<OperationIntentRecord>((entry) => {
    if (entry.intent.actionId === actionId) return [];
    if (target.intent.kind === 'claim' && entry.intent.kind === 'complete'
      && entry.intent.claimActionId === actionId) {
      return [{ ...entry, intent: { ...entry.intent, claimActionId: null } }];
    }
    return [entry];
  });
  return { ...queue, records };
}

export function createOperationIntentQueue(brandId: string, locationId: string): OperationIntentQueue {
  if (!UUID_PATTERN.test(brandId) || !UUID_PATTERN.test(locationId)) {
    throw new RangeError('Operation intent scope requires UUID brand and location ids.');
  }
  return { brandId, locationId, records: [] };
}

function assertQueueScope(queue: OperationIntentQueue, intent: OperationIntent): void {
  if (intent.brandId !== queue.brandId || intent.locationId !== queue.locationId) {
    throw new RangeError('Operation intent does not belong to this tenant and location queue.');
  }
}

function validClaimDependency(queue: OperationIntentQueue, intent: CompleteOperationIntent): boolean {
  if (intent.claimActionId === null) return true;
  const dependency = queue.records.find((entry) => entry.intent.actionId === intent.claimActionId);
  return dependency?.status === 'pending'
    && dependency.intent.kind === 'claim'
    && dependency.intent.occurrenceId === intent.occurrenceId;
}

/** Deduplicates retries by caller-supplied action id and appends accepted work FIFO. */
export function enqueueOperationIntent(
  queue: OperationIntentQueue,
  intent: OperationIntent,
): OperationIntentQueue {
  if (!isOperationIntent(intent)) throw new RangeError('Operation intent is malformed.');
  assertQueueScope(queue, intent);
  if (queue.records.some((entry) => entry.intent.actionId === intent.actionId)) return queue;
  if (intent.kind === 'complete' && !validClaimDependency(queue, intent)) {
    throw new RangeError('A dependent completion requires its pending claim first.');
  }
  return { ...queue, records: [...queue.records, { status: 'pending', intent }] };
}

/** Retains a permanent rejection as operator-visible audit state. */
export function recordPermanentIntentConflict(
  queue: OperationIntentQueue,
  actionId: string,
  conflict: PermanentOperationIntentConflict,
): OperationIntentQueue {
  if (!conflict.code.trim() || !conflict.message.trim()
    || !Number.isFinite(Date.parse(conflict.recordedAt))) {
    throw new RangeError('Permanent conflict metadata is invalid.');
  }
  const target = queue.records.find((entry) => entry.intent.actionId === actionId);
  if (!target || target.status === 'conflict') return queue;
  const dependsOnTarget = (entry: OperationIntentRecord) => target.intent.kind === 'claim'
    && entry.intent.kind === 'complete' && entry.intent.claimActionId === actionId;
  return {
    ...queue,
    records: queue.records.map((entry) => entry === target || dependsOnTarget(entry)
      ? { status: 'conflict', intent: entry.intent, conflict }
      : entry),
  };
}

/** Removes one action and completions that directly depend on its claim. */
export function removeOperationIntent(
  queue: OperationIntentQueue,
  actionId: string,
): OperationIntentQueue {
  const records = queue.records.filter((entry) => entry.intent.actionId !== actionId
    && !(entry.intent.kind === 'complete' && entry.intent.claimActionId === actionId));
  return records.length === queue.records.length ? queue : { ...queue, records };
}
