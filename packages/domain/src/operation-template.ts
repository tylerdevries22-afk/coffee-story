import type { OperationTemplateSnapshot } from './operation-types';

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
