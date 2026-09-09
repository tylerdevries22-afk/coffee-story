export const OPERATION_STATUSES = [
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

export type OperationSchedule = {
  id: string;
  locationId: string;
  timezone: string;
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
  dueWindowMinutes: number;
  graceMinutes: number;
};

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

export type OperationOccurrence = {
  id: string;
  status: OperationStatus;
  scheduledFor: string;
  dueAt: string;
  graceMinutes?: number;
  claimedBy: string | null;
  claimedAt?: string | null;
  claimExpiresAt?: string | null;
  completedAt: string | null;
};
