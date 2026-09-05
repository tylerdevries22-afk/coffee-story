import type {
  OperationOccurrence,
  OperationResponseKind,
} from '@platform/domain';

export type OperatorChecklistStep = {
  key: string; title: string; instructions: string;
  responseKind: OperationResponseKind;
  required: boolean; issueOnFailure: boolean; allowNotApplicable?: boolean;
  minimum?: number; maximum?: number; maxLength?: number;
};

export type OperatorTaskSnapshot = {
  templateId: string; templateKey: string; revision: number;
  title: string; instructions: string; estimatedMinutes: number;
  requiredRoleIds: readonly string[];
  requiredRoleLabels: readonly string[];
  requiredCompetencyKeys: readonly string[];
  issueCategories: readonly string[];
  steps: readonly OperatorChecklistStep[];
};

export type OperatorEligibility = {
  eligible: boolean; hasActiveShift: boolean;
  missingRoles: readonly string[];
  missingCompetencies: readonly string[];
};

export type OperatorTaskOccurrence = OperationOccurrence & {
  brandId: string; locationId: string;
  snapshot: OperatorTaskSnapshot; eligibility: OperatorEligibility;
  completedBy: string | null; completionNote: string; actorName: string | null;
};

export type OperatorTaskIssue = {
  id: string; occurrenceId: string; category: string;
  severity: 'low' | 'normal' | 'high' | 'urgent';
  description: string; stepKey: string | null;
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
};

export type OperatorNotification = {
  id: string; occurrenceId: string | null; title: string; body: string;
  createdAt: string; readAt: string | null;
};

export type OperatorQueueSnapshot = {
  occurrences: readonly OperatorTaskOccurrence[];
  issues: readonly OperatorTaskIssue[];
};
