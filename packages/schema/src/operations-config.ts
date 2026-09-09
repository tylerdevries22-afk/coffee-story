import {
  arrayAt,
  duplicateKeys,
  integerAt,
  objectAt,
} from './operations-config-readers';
import {
  parseEscalation,
  parseSchedule,
} from './operations-config-schedules';
import {
  parseCompetency,
  parseRole,
  parseTemplate,
} from './operations-config-templates';
import type {
  TenantOperationsConfig,
  TenantOperationsParseResult,
} from './operations-config-types';

export * from './operations-config-types';

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
