const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const RESPONSE_KINDS = new Set(['confirm', 'pass_fail', 'number', 'text']);
const RECIPIENT_ROLES = new Set(['eligible_staff', 'location_manager', 'brand_owner']);
const CHANNELS = new Set(['in_app', 'push']);
const ROUTINE_KINDS = new Set(['opening', 'interval', 'closing', 'ad_hoc']);
const SCHEDULE_KINDS = new Set([
  'fixed_time', 'opening_offset', 'closing_offset', 'open_interval',
]);

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

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, path: string, errors: string[]): JsonObject {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as JsonObject;
  errors.push(`${path} must be an object.`);
  return {};
}

function arrayAt(value: unknown, path: string, errors: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  errors.push(`${path} must be an array.`);
  return [];
}

function textAt(value: unknown, path: string, errors: string[], fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value;
  errors.push(`${path} must be text.`);
  return fallback;
}

function requiredTextAt(value: unknown, path: string, errors: string[]): string {
  const result = textAt(value, path, errors);
  if (result.trim().length === 0) errors.push(`${path} is required.`);
  return result;
}

function integerAt(
  value: unknown,
  path: string,
  errors: string[],
  bounds: readonly [number, number],
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && (value as number) >= bounds[0] && (value as number) <= bounds[1]) {
    return value as number;
  }
  errors.push(`${path} must be an integer from ${bounds[0]} through ${bounds[1]}.`);
  return fallback;
}

function booleanAt(value: unknown, path: string, errors: string[], fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  errors.push(`${path} must be true or false.`);
  return fallback;
}

function keyAt(value: unknown, path: string, errors: string[]): string {
  const key = textAt(value, path, errors);
  if (!KEY_PATTERN.test(key)) errors.push(`${path} must be a lowercase kebab-case key.`);
  return key;
}

function textList(value: unknown, path: string, errors: string[]): string[] {
  const rows = arrayAt(value ?? [], path, errors);
  const texts = rows.filter((row): row is string => typeof row === 'string');
  if (texts.length !== rows.length) errors.push(`${path} must contain only text values.`);
  if (new Set(texts).size !== texts.length) errors.push(`${path} must not contain duplicates.`);
  return texts;
}

function parseRole(value: unknown, index: number, errors: string[]): TenantOperationRole {
  const path = `roles[${index}]`;
  const row = objectAt(value, path, errors);
  return {
    key: keyAt(row.key, `${path}.key`, errors),
    title: requiredTextAt(row.title, `${path}.title`, errors),
    description: textAt(row.description, `${path}.description`, errors),
  };
}

function parseCompetency(value: unknown, index: number, errors: string[]): TenantOperationCompetency {
  const path = `competencies[${index}]`;
  const row = objectAt(value, path, errors);
  return {
    key: keyAt(row.key, `${path}.key`, errors),
    title: requiredTextAt(row.title, `${path}.title`, errors),
    renewalDays: row.renewalDays === null || row.renewalDays === undefined
      ? null
      : integerAt(row.renewalDays, `${path}.renewalDays`, errors, [1, 3650], 365),
  };
}

function parseConstraints(row: JsonObject, path: string, errors: string[]) {
  const constraints: TenantOperationStep['constraints'] = {};
  if (row.minimum !== undefined && typeof row.minimum !== 'number') errors.push(`${path}.minimum must be a number.`);
  else if (typeof row.minimum === 'number') constraints.minimum = row.minimum;
  if (row.maximum !== undefined && typeof row.maximum !== 'number') errors.push(`${path}.maximum must be a number.`);
  else if (typeof row.maximum === 'number') constraints.maximum = row.maximum;
  if (constraints.minimum !== undefined && constraints.maximum !== undefined
    && constraints.minimum > constraints.maximum) errors.push(`${path}.minimum must not exceed maximum.`);
  if (row.maxLength !== undefined) {
    constraints.maxLength = integerAt(row.maxLength, `${path}.maxLength`, errors, [1, 10_000], 2_000);
  }
  return constraints;
}

function parseStep(value: unknown, index: number, templatePath: string, errors: string[]): TenantOperationStep {
  const path = `${templatePath}.steps[${index}]`;
  const row = objectAt(value, path, errors);
  const responseKind = textAt(row.responseKind, `${path}.responseKind`, errors, 'confirm');
  const issueOnFailure = booleanAt(row.issueOnFailure, `${path}.issueOnFailure`, errors, false);
  if (!RESPONSE_KINDS.has(responseKind)) errors.push(`${path}.responseKind is unsupported.`);
  if (issueOnFailure && responseKind !== 'pass_fail') {
    errors.push(`${path}.issueOnFailure requires a pass_fail response.`);
  }
  if (responseKind !== 'number' && (row.minimum !== undefined || row.maximum !== undefined)) {
    errors.push(`${path}.minimum and maximum apply only to number responses.`);
  }
  if (responseKind !== 'text' && row.maxLength !== undefined) {
    errors.push(`${path}.maxLength applies only to text responses.`);
  }
  return {
    key: keyAt(row.key, `${path}.key`, errors),
    title: requiredTextAt(row.title, `${path}.title`, errors),
    instructions: textAt(row.instructions, `${path}.instructions`, errors),
    responseKind: RESPONSE_KINDS.has(responseKind)
      ? responseKind as TenantOperationStep['responseKind'] : 'confirm',
    required: booleanAt(row.required, `${path}.required`, errors, true),
    issueOnFailure,
    allowNotApplicable: booleanAt(
      row.allowNotApplicable,
      `${path}.allowNotApplicable`,
      errors,
      false,
    ),
    constraints: parseConstraints(row, path, errors),
  };
}

function parseTemplate(value: unknown, index: number, errors: string[]): TenantOperationTemplate {
  const path = `templates[${index}]`;
  const row = objectAt(value, path, errors);
  const steps = arrayAt(row.steps, `${path}.steps`, errors)
    .map((step, stepIndex) => parseStep(step, stepIndex, path, errors));
  duplicateKeys(steps, `${path}.steps`, errors);
  const routineKind = textAt(row.routineKind, `${path}.routineKind`, errors, 'ad_hoc');
  if (!ROUTINE_KINDS.has(routineKind)) errors.push(`${path}.routineKind is unsupported.`);
  return {
    key: keyAt(row.key, `${path}.key`, errors),
    programKey: keyAt(row.programKey, `${path}.programKey`, errors),
    routineKind: ROUTINE_KINDS.has(routineKind)
      ? routineKind as TenantOperationTemplate['routineKind'] : 'ad_hoc',
    revision: integerAt(row.revision, `${path}.revision`, errors, [1, 1_000_000], 1),
    title: requiredTextAt(row.title, `${path}.title`, errors),
    instructions: textAt(row.instructions, `${path}.instructions`, errors),
    estimatedMinutes: integerAt(row.estimatedMinutes, `${path}.estimatedMinutes`, errors, [1, 1440], 10),
    requiredRoleKeys: textList(row.requiredRoleKeys, `${path}.requiredRoleKeys`, errors),
    requiredCompetencyKeys: textList(row.requiredCompetencyKeys, `${path}.requiredCompetencyKeys`, errors),
    issueCategories: textList(row.issueCategories, `${path}.issueCategories`, errors),
    steps,
  };
}

function nullableDate(value: unknown, path: string, errors: string[]): string | null {
  if (value === undefined || value === null || value === '') return null;
  const result = textAt(value, path, errors);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(result) ? new Date(`${result}T00:00:00Z`) : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) {
    errors.push(`${path} must use a valid YYYY-MM-DD date.`);
  }
  return result;
}

function parseWeekdays(value: unknown, path: string, errors: string[]): number[] {
  const rows = arrayAt(value === undefined ? [1, 2, 3, 4, 5, 6, 7] : value, path, errors);
  const weekdays = rows.filter((day): day is number => Number.isInteger(day));
  if (weekdays.length === 0 || weekdays.some((day) => day < 1 || day > 7)
    || weekdays.length !== rows.length || new Set(weekdays).size !== weekdays.length) {
    errors.push(`${path} must contain unique ISO weekdays.`);
  }
  return weekdays;
}

function parseScheduleRule(value: unknown, path: string, errors: string[]): TenantOperationScheduleRule {
  const row = objectAt(value, path, errors);
  const kind = textAt(row.kind, `${path}.kind`, errors);
  const weekdays = parseWeekdays(row.weekdays, `${path}.weekdays`, errors);
  if (!SCHEDULE_KINDS.has(kind)) errors.push(`${path}.kind is unsupported.`);
  if (kind === 'fixed_time') {
    const localTime = requiredTextAt(row.localTime, `${path}.localTime`, errors);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(localTime)) {
      errors.push(`${path}.localTime must use 24-hour HH:MM time.`);
    }
    return { kind, localTime, weekdays };
  }
  if (kind === 'opening_offset' || kind === 'closing_offset') {
    return {
      kind,
      offsetMinutes: integerAt(row.offsetMinutes, `${path}.offsetMinutes`, errors, [-1440, 1440], 0),
      weekdays,
    };
  }
  return {
    kind: 'open_interval',
    intervalMinutes: integerAt(
      row.intervalMinutes,
      `${path}.intervalMinutes`,
      errors,
      [15, 1440],
      60,
    ),
    startOffsetMinutes: integerAt(
      row.startOffsetMinutes,
      `${path}.startOffsetMinutes`,
      errors,
      [-1440, 1440],
      0,
    ),
    endOffsetMinutes: integerAt(
      row.endOffsetMinutes,
      `${path}.endOffsetMinutes`,
      errors,
      [-1440, 1440],
      0,
    ),
    weekdays,
  };
}

function parseSchedule(value: unknown, index: number, errors: string[]): TenantOperationSchedule {
  const path = `schedules[${index}]`;
  const row = objectAt(value, path, errors);
  const activeFrom = nullableDate(row.activeFrom, `${path}.activeFrom`, errors);
  const activeUntil = nullableDate(row.activeUntil, `${path}.activeUntil`, errors);
  if (activeFrom && activeUntil && activeUntil < activeFrom) {
    errors.push(`${path}.activeUntil must be on or after activeFrom.`);
  }
  return {
    key: keyAt(row.key, `${path}.key`, errors),
    templateKey: keyAt(row.templateKey, `${path}.templateKey`, errors),
    rule: parseScheduleRule(row.rule, `${path}.rule`, errors),
    dueWindowMinutes: integerAt(row.dueWindowMinutes, `${path}.dueWindowMinutes`, errors, [1, 1440], 30),
    graceMinutes: integerAt(row.graceMinutes, `${path}.graceMinutes`, errors, [0, 1440], 10),
    activeFrom,
    activeUntil,
    enabled: booleanAt(row.enabled, `${path}.enabled`, errors, true),
  };
}

function parseEscalation(value: unknown, index: number, errors: string[]): TenantOperationEscalation {
  const path = `escalations[${index}]`;
  const row = objectAt(value, path, errors);
  const recipientRole = textAt(row.recipientRole, `${path}.recipientRole`, errors);
  const channels = textList(row.channels, `${path}.channels`, errors);
  if (!RECIPIENT_ROLES.has(recipientRole)) errors.push(`${path}.recipientRole is unsupported.`);
  if (channels.length === 0 || channels.some((channel) => !CHANNELS.has(channel))) {
    errors.push(`${path}.channels must use in_app or push.`);
  }
  return {
    scheduleKey: row.scheduleKey === undefined || row.scheduleKey === null
      ? null : keyAt(row.scheduleKey, `${path}.scheduleKey`, errors),
    order: integerAt(row.order, `${path}.order`, errors, [1, 20], index + 1),
    offsetMinutes: integerAt(row.offsetMinutes, `${path}.offsetMinutes`, errors, [0, 43_200], 0),
    recipientRole: RECIPIENT_ROLES.has(recipientRole)
      ? recipientRole as TenantOperationEscalation['recipientRole'] : 'brand_owner',
    channels: channels.filter((channel): channel is TenantOperationEscalation['channels'][number] => CHANNELS.has(channel)),
  };
}

function duplicateKeys(rows: readonly { key: string }[], path: string, errors: string[]): void {
  const keys = rows.map((row) => row.key);
  if (new Set(keys).size !== keys.length) errors.push(`${path} keys must be unique.`);
}

function validateReferences(config: TenantOperationsConfig, errors: string[]): void {
  const roles = new Set(config.roles.map((role) => role.key));
  const competencies = new Set(config.competencies.map((competency) => competency.key));
  const templates = new Set(config.templates.map((template) => template.key));
  const schedules = new Set(config.schedules.map((schedule) => schedule.key));
  for (const template of config.templates) {
    for (const key of template.requiredRoleKeys) if (!roles.has(key)) errors.push(`Template ${template.key} references unknown role ${key}.`);
    for (const key of template.requiredCompetencyKeys) if (!competencies.has(key)) {
      errors.push(`Template ${template.key} references unknown competency ${key}.`);
    }
  }
  for (const schedule of config.schedules) if (!templates.has(schedule.templateKey)) {
    errors.push(`Schedule ${schedule.key} references unknown template ${schedule.templateKey}.`);
  }
  for (const escalation of config.escalations) if (escalation.scheduleKey && !schedules.has(escalation.scheduleKey)) {
    errors.push(`Escalation references unknown schedule ${escalation.scheduleKey}.`);
  }
  const escalationKeys = config.escalations.map((item) => `${item.scheduleKey ?? 'default'}:${item.order}`);
  if (new Set(escalationKeys).size !== escalationKeys.length) {
    errors.push('Escalation order must be unique within each schedule or brand default.');
  }
}

function parseRetention(value: unknown, errors: string[]): TenantOperationsConfig['retention'] {
  const row = objectAt(value, 'retention', errors);
  return {
    evidenceDays: integerAt(row.evidenceDays, 'retention.evidenceDays', errors, [30, 3650], 365),
    issueDays: integerAt(row.issueDays, 'retention.issueDays', errors, [30, 3650], 730),
    actorIdentityDays: integerAt(row.actorIdentityDays, 'retention.actorIdentityDays', errors, [30, 3650], 365),
  };
}

export function parseTenantOperations(value: unknown, enabled: boolean): TenantOperationsParseResult {
  const errors: string[] = [];
  const row = objectAt(value, 'operations.json', errors);
  const config: TenantOperationsConfig = {
    roles: arrayAt(row.roles === undefined ? [] : row.roles, 'roles', errors)
      .map((item, index) => parseRole(item, index, errors)),
    competencies: arrayAt(row.competencies === undefined ? [] : row.competencies, 'competencies', errors)
      .map((item, index) => parseCompetency(item, index, errors)),
    templates: arrayAt(row.templates === undefined ? [] : row.templates, 'templates', errors)
      .map((item, index) => parseTemplate(item, index, errors)),
    schedules: arrayAt(row.schedules === undefined ? [] : row.schedules, 'schedules', errors)
      .map((item, index) => parseSchedule(item, index, errors)),
    escalations: arrayAt(row.escalations === undefined ? [] : row.escalations, 'escalations', errors)
      .map((item, index) => parseEscalation(item, index, errors)),
    retention: parseRetention(row.retention === undefined ? {} : row.retention, errors),
  };
  for (const [path, items] of [['roles', config.roles], ['competencies', config.competencies],
    ['templates', config.templates], ['schedules', config.schedules]] as const) duplicateKeys(items, path, errors);
  validateReferences(config, errors);
  if (!enabled && (config.templates.length > 0 || config.schedules.length > 0)) {
    errors.push('Operations templates and schedules require features.operations.');
  }
  return errors.length > 0 ? { value: null, errors } : { value: config, errors: [] };
}
