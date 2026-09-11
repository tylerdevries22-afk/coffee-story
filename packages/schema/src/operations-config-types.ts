export type TenantOperationRole = {
  key: string;
  title: string;
  description: string;
};

export type TenantOperationCompetency = {
  key: string;
  title: string;
  renewalDays: number | null;
};

export type TenantOperationStep = {
  key: string;
  title: string;
  instructions: string;
  responseKind: 'confirm' | 'pass_fail' | 'number' | 'text';
  required: boolean;
  issueOnFailure: boolean;
  allowNotApplicable: boolean;
  constraints: { minimum?: number; maximum?: number; maxLength?: number };
};

export type TenantOperationTemplate = {
  key: string;
  programKey: string;
  routineKind: 'opening' | 'interval' | 'closing' | 'ad_hoc';
  revision: number;
  title: string;
  instructions: string;
  estimatedMinutes: number;
  requiredRoleKeys: string[];
  requiredCompetencyKeys: string[];
  issueCategories: string[];
  steps: TenantOperationStep[];
};

export type TenantOperationScheduleRule =
  | { kind: 'fixed_time'; localTime: string; weekdays: number[] }
  | { kind: 'opening_offset'; offsetMinutes: number; weekdays: number[] }
  | { kind: 'closing_offset'; offsetMinutes: number; weekdays: number[] }
  | {
    kind: 'open_interval';
    intervalMinutes: number;
    startOffsetMinutes: number;
    endOffsetMinutes: number;
    weekdays: number[];
  };

export type TenantOperationSchedule = {
  key: string;
  templateKey: string;
  rule: TenantOperationScheduleRule;
  dueWindowMinutes: number;
  graceMinutes: number;
  activeFrom: string | null;
  activeUntil: string | null;
  enabled: boolean;
};

export type TenantOperationEscalation = {
  scheduleKey: string | null;
  order: number;
  offsetMinutes: number;
  recipientRole: 'eligible_staff' | 'location_manager' | 'brand_owner';
  channels: ('in_app' | 'push')[];
};

export type TenantOperationsConfig = {
  roles: TenantOperationRole[];
  competencies: TenantOperationCompetency[];
  templates: TenantOperationTemplate[];
  schedules: TenantOperationSchedule[];
  escalations: TenantOperationEscalation[];
  retention: { evidenceDays: number; issueDays: number; actorIdentityDays: number };
};

export type TenantOperationsParseResult =
  | { value: TenantOperationsConfig; errors: [] }
  | { value: null; errors: string[] };
