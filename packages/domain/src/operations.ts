export const OPERATION_STATUSES = [
<<<<<<< ours
  'scheduled', 'claimed', 'completed', 'missed', 'cancelled',
] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type OperationDisplayStatus = OperationStatus | 'overdue';
export type OperationResponseKind = 'confirm' | 'pass_fail' | 'number' | 'text';

export type OperationScheduleRule =
  | { kind: 'fixed_time'; localTime: string; weekdays: readonly number[] }
  | { kind: 'opening_offset'; offsetMinutes: number; weekdays: readonly number[] }
  | { kind: 'closing_offset'; offsetMinutes: number; weekdays: readonly number[] }
  | {
    kind: 'open_interval';
    intervalMinutes: number;
    startOffsetMinutes: number;
    endOffsetMinutes: number;
    weekdays: readonly number[];
  };

export type OperationRecurrence =
  | { frequency: 'daily' }
  | { frequency: 'weekly'; weekdays: readonly number[] };

=======
  'upcoming', 'due', 'claimed', 'completed', 'overdue', 'waived', 'cancelled',
] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];
>>>>>>> theirs
export type OperationSchedule = {
  id: string;
  locationId: string;
  timezone: string;
<<<<<<< ours
  rule: OperationScheduleRule;
  dueWindowMinutes: number;
  graceMinutes: number;
};

export type ChecklistStep = {
  key: string;
  title?: string;
  instructions?: string;
  responseKind: OperationResponseKind;
  required: boolean;
  issueOnFailure?: boolean;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  allowNotApplicable?: boolean;
};

export type ChecklistNotApplicable = { state: 'not_applicable'; reason: string };

export type OperationTemplateSnapshot = {
  templateId: string;
  templateKey: string;
  programKey: string;
  routineKind: 'opening' | 'interval' | 'closing' | 'ad_hoc';
  revision: number;
  title: string;
  instructions: string;
  estimatedMinutes: number;
  requiredRoleIds: readonly string[];
  requiredCompetencyKeys: readonly string[];
  issueCategories: readonly string[];
  steps: readonly ChecklistStep[];
};

export type OperationRoutineDefinition = Omit<OperationTemplateSnapshot, 'templateId' | 'revision'> & {
  schedule: OperationScheduleRule;
=======
  /** A deliberately bounded v1 contract: daily or selected ISO weekdays. */
  weekdays: readonly number[];
  localStartTime: string;
>>>>>>> theirs
  dueWindowMinutes: number;
  graceMinutes: number;
};

<<<<<<< ours
export type OperationTemplateDefinition = {
  key: string;
  title: string;
  revision: number;
  routines: readonly OperationRoutineDefinition[];
};

export type OperationProgramRevision = {
  id: string;
  brandId: string;
  locationId: string;
  sourceTemplateId: string | null;
  sourceRevision: number | null;
  revision: number;
  isLocalFork: boolean;
  routines: readonly OperationRoutineDefinition[];
};

export type ChecklistSubmission = {
  actionId: string;
  occurrenceId: string;
  responses: Readonly<Record<string, unknown>>;
  note?: string;
  issues?: readonly OperationIssueInput[];
};

export type OperationIssueInput = {
  actionId: string;
  occurrenceId: string;
  category: string;
  severity: 'low' | 'normal' | 'high' | 'urgent';
  description: string;
  stepKey?: string;
};

export type CompetencyAward = {
  id: string;
  competencyKey: string;
  brandUserId: string;
  source: 'training' | 'manager_verification';
  awardedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type OperatorNotification = {
  id: string;
  occurrenceId: string | null;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

=======
>>>>>>> theirs
export type OperationOccurrence = {
  id: string;
  status: OperationStatus;
  scheduledFor: string;
  dueAt: string;
<<<<<<< ours
  graceMinutes?: number;
  claimedBy: string | null;
  claimedAt?: string | null;
  claimExpiresAt?: string | null;
=======
  claimedBy: string | null;
>>>>>>> theirs
  completedAt: string | null;
};

const TRANSITIONS: Readonly<Record<OperationStatus, readonly OperationStatus[]>> = {
<<<<<<< ours
  scheduled: ['claimed', 'missed', 'cancelled'],
  claimed: ['scheduled', 'completed', 'missed', 'cancelled'],
  completed: [],
  missed: [],
=======
  upcoming: ['due', 'claimed', 'cancelled'],
  due: ['claimed', 'overdue', 'waived', 'cancelled'],
  claimed: ['due', 'completed', 'overdue', 'waived', 'cancelled'],
  completed: [],
  overdue: ['claimed', 'completed', 'waived', 'cancelled'],
  waived: [],
>>>>>>> theirs
  cancelled: [],
};

export function canTransitionOperation(from: OperationStatus, to: OperationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

<<<<<<< ours
function instant(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new RangeError(`Invalid operation timestamp: ${value}`);
  return milliseconds;
}

/** Derives presentation state without mutating the database-owned workflow state. */
export function operationDisplayStatus(
  occurrence: OperationOccurrence,
  now: Date,
): OperationDisplayStatus {
  if (['completed', 'missed', 'cancelled'].includes(occurrence.status)) return occurrence.status;
  if (now.getTime() > instant(occurrence.dueAt)) return 'overdue';
  if (occurrence.claimedBy) return 'claimed';
  return 'scheduled';
=======
export function operationDisplayStatus(
  occurrence: OperationOccurrence,
  now: Date,
): OperationStatus {
  if (['completed', 'waived', 'cancelled'].includes(occurrence.status)) return occurrence.status;
  if (now.getTime() > new Date(occurrence.dueAt).getTime()) return 'overdue';
  if (occurrence.claimedBy) return 'claimed';
  if (now.getTime() >= new Date(occurrence.scheduledFor).getTime()) return 'due';
  return 'upcoming';
>>>>>>> theirs
}

export type OperationRequirement = {
  roleIds: readonly string[];
  competencyKeys: readonly string[];
};

export type WorkerEligibility = {
  roleIds: readonly string[];
  competencyAwards: Readonly<Record<string, string | null>>;
};

<<<<<<< ours
export type OperationEligibility = {
  eligible: boolean;
  missingRoles: string[];
  missingCompetencies: string[];
};

=======
>>>>>>> theirs
export function operationEligibility(
  requirement: OperationRequirement,
  worker: WorkerEligibility,
  now: Date,
<<<<<<< ours
): OperationEligibility {
  const missingRoles = requirement.roleIds.length > 0
    && !requirement.roleIds.some((role) => worker.roleIds.includes(role))
    ? [...requirement.roleIds]
    : [];
  const missingCompetencies = requirement.competencyKeys.filter((key) => {
    if (!(key in worker.competencyAwards)) return true;
    const expiry = worker.competencyAwards[key];
    return expiry !== null && (expiry === undefined || !Number.isFinite(Date.parse(expiry))
      || Date.parse(expiry) <= now.getTime());
  });
  return {
    eligible: missingRoles.length === 0 && missingCompetencies.length === 0,
    missingRoles,
    missingCompetencies,
  };
}

export type OperationResponseValidation = {
  valid: boolean;
  missing: string[];
  invalid: string[];
  unknown: string[];
  unresolvedFailures: string[];
};

function validResponse(step: ChecklistStep, value: unknown): boolean {
  if (step.allowNotApplicable && typeof value === 'object' && value !== null
    && 'state' in value && value.state === 'not_applicable'
    && 'reason' in value && typeof value.reason === 'string') {
    return value.reason.trim().length >= 3 && value.reason.length <= 500;
  }
  if (step.responseKind === 'confirm') return value === true;
  if (step.responseKind === 'pass_fail') return typeof value === 'boolean';
  if (step.responseKind === 'number') {
    return typeof value === 'number'
      && Number.isFinite(value)
      && (step.minimum === undefined || value >= step.minimum)
      && (step.maximum === undefined || value <= step.maximum);
  }
  return typeof value === 'string'
    && (!step.required || value.trim().length > 0)
    && (step.maxLength === undefined || value.length <= step.maxLength);
}

export function validateOperationResponses(
  steps: readonly ChecklistStep[],
  responses: Readonly<Record<string, unknown>>,
  issueStepKeys: ReadonlySet<string> = new Set(),
): OperationResponseValidation {
  const stepKeys = new Set(steps.map((step) => step.key));
  const missing = steps
    .filter((step) => step.required && !(step.key in responses))
    .map((step) => step.key);
  const invalid = steps
    .filter((step) => step.key in responses && !validResponse(step, responses[step.key]))
    .map((step) => step.key);
  const unknown = Object.keys(responses).filter((key) => !stepKeys.has(key));
  const unresolvedFailures = steps
    .filter((step) => step.issueOnFailure && responses[step.key] === false && !issueStepKeys.has(step.key))
    .map((step) => step.key);
  return {
    valid: missing.length === 0 && invalid.length === 0
      && unknown.length === 0 && unresolvedFailures.length === 0,
    missing,
    invalid,
    unknown,
    unresolvedFailures,
  };
}

export type EscalationRule = { id: string; offsetMinutes: number; order?: number };
=======
): { eligible: boolean; missingRoles: string[]; missingCompetencies: string[] } {
  const missingRoles = requirement.roleIds.length > 0 &&
    !requirement.roleIds.some((role) => worker.roleIds.includes(role))
    ? [...requirement.roleIds] : [];
  const missingCompetencies = requirement.competencyKeys.filter((key) => {
    if (!(key in worker.competencyAwards)) return true;
    const expiry = worker.competencyAwards[key]!;
    return expiry !== null && new Date(expiry).getTime() <= now.getTime();
  });
  return { eligible: missingRoles.length === 0 && missingCompetencies.length === 0,
    missingRoles, missingCompetencies };
}

export type ChecklistStep = {
  key: string;
  responseKind: 'confirm' | 'pass_fail' | 'number' | 'text';
  required: boolean;
};

export function validateOperationResponses(
  steps: readonly ChecklistStep[],
  responses: Readonly<Record<string, unknown>>,
): { valid: boolean; missing: string[]; invalid: string[] } {
  const missing = steps.filter((step) => step.required && !(step.key in responses)).map((step) => step.key);
  const invalid = steps.filter((step) => {
    if (!(step.key in responses)) return false;
    const value = responses[step.key];
    if (step.responseKind === 'confirm' || step.responseKind === 'pass_fail') return typeof value !== 'boolean';
    if (step.responseKind === 'number') return typeof value !== 'number' || !Number.isFinite(value);
    return typeof value !== 'string';
  }).map((step) => step.key);
  return { valid: missing.length === 0 && invalid.length === 0, missing, invalid };
}

export type EscalationRule = { id: string; offsetMinutes: number };
>>>>>>> theirs

export function dueEscalations(
  dueAt: string,
  rules: readonly EscalationRule[],
  alreadyCreatedRuleIds: ReadonlySet<string>,
  now: Date,
): EscalationRule[] {
<<<<<<< ours
  const due = instant(dueAt);
  return rules
    .filter((rule) => Number.isInteger(rule.offsetMinutes) && rule.offsetMinutes >= 0)
    .filter((rule) => !alreadyCreatedRuleIds.has(rule.id)
      && now.getTime() >= due + rule.offsetMinutes * 60_000)
    .sort((left, right) => (left.order ?? left.offsetMinutes) - (right.order ?? right.offsetMinutes));
}

export type OperationMetrics = {
  accountable: number;
  completed: number;
  completedOnTime: number;
  overdue: number;
  missed: number;
  completionRate: number | null;
  onTimeRate: number | null;
  overdueRate: number | null;
};

export function operationMetrics(occurrences: readonly OperationOccurrence[]): OperationMetrics {
  const accountableRows = occurrences.filter((item) => (
    item.status === 'completed' || item.status === 'missed'
  ));
  const completedRows = accountableRows.filter((item) => item.status === 'completed');
  const completedOnTime = completedRows.filter((item) => item.completedAt !== null
    && instant(item.completedAt) <= instant(item.dueAt)).length;
  const overdue = accountableRows.length - completedOnTime;
  const ratio = (numerator: number): number | null => accountableRows.length === 0
    ? null
    : numerator / accountableRows.length;
  return {
    accountable: accountableRows.length,
    completed: completedRows.length,
    completedOnTime,
    overdue,
    missed: occurrences.filter((item) => item.status === 'missed').length,
    completionRate: ratio(completedRows.length),
    onTimeRate: ratio(completedOnTime),
    overdueRate: ratio(overdue),
  };
}

export function operationRunsOnIsoWeekday(
  rule: OperationScheduleRule | OperationRecurrence,
  isoWeekday: number,
): boolean {
  if (!Number.isInteger(isoWeekday) || isoWeekday < 1 || isoWeekday > 7) return false;
  if ('frequency' in rule) return rule.frequency === 'daily' || rule.weekdays.includes(isoWeekday);
  return rule.weekdays.includes(isoWeekday);
}

function validMinuteOffset(value: number): boolean {
  return Number.isInteger(value) && value >= -1_440 && value <= 1_440;
}

export function validateOperationScheduleRule(rule: OperationScheduleRule): string[] {
  const unique = new Set(rule.weekdays);
  if (unique.size === 0) return ['Select at least one weekday.'];
  if (unique.size !== rule.weekdays.length) return ['Weekdays must not repeat.'];
  if (!rule.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) {
    return ['Weekdays must use ISO values from 1 (Monday) through 7 (Sunday).'];
  }
  if (rule.kind === 'fixed_time') {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.localTime)
      ? [] : ['Fixed-time schedules require a 24-hour HH:MM time.'];
  }
  if (rule.kind === 'opening_offset' || rule.kind === 'closing_offset') {
    return validMinuteOffset(rule.offsetMinutes)
      ? [] : ['Opening and closing offsets must be whole minutes from -1440 through 1440.'];
  }
  const errors: string[] = [];
  if (!Number.isInteger(rule.intervalMinutes)
    || rule.intervalMinutes < 15 || rule.intervalMinutes > 1_440) {
    errors.push('Open-hour intervals must be whole minutes from 15 through 1440.');
  }
  if (!validMinuteOffset(rule.startOffsetMinutes) || !validMinuteOffset(rule.endOffsetMinutes)) {
    errors.push('Open-hour offsets must be whole minutes from -1440 through 1440.');
  }
  return errors;
}

export function validateOperationRecurrence(rule: OperationRecurrence): string[] {
  if (rule.frequency === 'daily') return [];
  const unique = new Set(rule.weekdays);
  if (unique.size === 0) return ['Select at least one weekday.'];
  if (unique.size !== rule.weekdays.length) return ['Weekdays must not repeat.'];
  return rule.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    ? [] : ['Weekdays must use ISO values from 1 (Monday) through 7 (Sunday).'];
}

export type OperationRetentionPolicy = {
  evidenceDays: number;
  issueDays: number;
  actorIdentityDays: number;
};

export function validateOperationRetention(policy: OperationRetentionPolicy): string[] {
  const fields: readonly [keyof OperationRetentionPolicy, string][] = [
    ['evidenceDays', 'Evidence retention'],
    ['issueDays', 'Issue retention'],
    ['actorIdentityDays', 'Actor identity retention'],
  ];
  return fields.flatMap(([key, label]) => Number.isInteger(policy[key])
    && policy[key] >= 30 && policy[key] <= 3650
    ? []
    : [`${label} must be between 30 and 3650 days.`]);
}

export type OperationTemplateDiff = {
  field: keyof Pick<OperationTemplateSnapshot,
    'title' | 'instructions' | 'estimatedMinutes' | 'requiredRoleIds' | 'requiredCompetencyKeys' | 'issueCategories' | 'steps'>;
  changed: boolean;
};

export function diffOperationTemplates(
  brandTemplate: OperationTemplateSnapshot,
  locationTemplate: OperationTemplateSnapshot,
): OperationTemplateDiff[] {
  const fields: OperationTemplateDiff['field'][] = [
    'title', 'instructions', 'estimatedMinutes', 'requiredRoleIds',
    'requiredCompetencyKeys', 'issueCategories', 'steps',
  ];
  return fields.map((field) => ({
    field,
    changed: JSON.stringify(brandTemplate[field]) !== JSON.stringify(locationTemplate[field]),
  }));
}
=======
  const due = new Date(dueAt).getTime();
  return rules.filter((rule) => !alreadyCreatedRuleIds.has(rule.id) &&
    now.getTime() >= due + rule.offsetMinutes * 60_000);
}

export function operationMetrics(occurrences: readonly OperationOccurrence[]): {
  total: number; completed: number; overdue: number; onTimeRate: number;
} {
  const completed = occurrences.filter((item) => item.status === 'completed').length;
  const overdue = occurrences.filter((item) => item.status === 'overdue' ||
    (item.completedAt !== null && new Date(item.completedAt) > new Date(item.dueAt))).length;
  return {
    total: occurrences.length,
    completed,
    overdue,
    onTimeRate: occurrences.length === 0 ? 1 : (occurrences.length - overdue) / occurrences.length,
  };
}
>>>>>>> theirs
