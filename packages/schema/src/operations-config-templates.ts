import {
  arrayAt,
  booleanAt,
  duplicateKeys,
  integerAt,
  keyAt,
  objectAt,
  requiredTextAt,
  textAt,
  textList,
  type JsonObject,
} from './operations-config-readers';
import type {
  TenantOperationCompetency,
  TenantOperationRole,
  TenantOperationStep,
  TenantOperationTemplate,
} from './operations-config-types';

const RESPONSE_KINDS = new Set(['confirm', 'pass_fail', 'number', 'text']);
const ROUTINE_KINDS = new Set(['opening', 'interval', 'closing', 'ad_hoc']);

export function parseRole(value: unknown, index: number, errors: string[]): TenantOperationRole {
  const path = `roles[${index}]`;
  const row = objectAt(value, path, errors);
  return {
    key: keyAt(row.key, `${path}.key`, errors),
    title: requiredTextAt(row.title, `${path}.title`, errors),
    description: textAt(row.description, `${path}.description`, errors),
  };
}

export function parseCompetency(value: unknown, index: number, errors: string[]): TenantOperationCompetency {
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

export function parseTemplate(value: unknown, index: number, errors: string[]): TenantOperationTemplate {
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
