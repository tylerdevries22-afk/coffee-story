import type { ChecklistStep } from './operation-types';

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
