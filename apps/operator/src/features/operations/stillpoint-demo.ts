import stillpointOperations from '../../../../../tenants/stillpoint-builders/operations.json';

import type {
  OperatorChecklistStep, OperatorTaskOccurrence, OperatorTaskSnapshot,
} from './model';

type ConfigStep = {
  key: string; title: string; instructions?: string; responseKind: string;
  required?: boolean; issueOnFailure?: boolean; allowNotApplicable?: boolean;
  minimum?: number; maximum?: number; maxLength?: number;
};
type ConfigTemplate = {
  key: string; title: string; instructions: string; estimatedMinutes: number;
  requiredRoleKeys: string[]; requiredCompetencyKeys: string[];
  issueCategories: string[]; steps: ConfigStep[];
};

const templates = stillpointOperations.templates as ConfigTemplate[];
const roleNames = new Map(stillpointOperations.roles.map((role) => [role.key, role.title]));
const IDS = [
  '20000000-0000-4000-8000-000000000110',
  '20000000-0000-4000-8000-000000000111',
  '20000000-0000-4000-8000-000000000112',
  '20000000-0000-4000-8000-000000000113',
  '20000000-0000-4000-8000-000000000114',
  '20000000-0000-4000-8000-000000000115',
] as const;
const ACTORS = ['Maya Chen', 'Jon Bell', 'Luis Ortega', 'Avery Stone', 'Nina Patel', 'Eli Brooks'];

function instant(now: Date, offsetMinutes: number): string {
  return new Date(now.getTime() + offsetMinutes * 60_000).toISOString();
}

function stepFromConfig(step: ConfigStep): OperatorChecklistStep {
  return {
    key: step.key, title: step.title, instructions: step.instructions ?? '',
    responseKind: ['confirm', 'pass_fail', 'number', 'text'].includes(step.responseKind)
      ? step.responseKind as OperatorChecklistStep['responseKind'] : 'confirm',
    required: step.required !== false, issueOnFailure: step.issueOnFailure === true,
    allowNotApplicable: step.allowNotApplicable, minimum: step.minimum,
    maximum: step.maximum, maxLength: step.maxLength,
  };
}

function snapshot(template: ConfigTemplate, index: number): OperatorTaskSnapshot {
  return {
    templateId: `20000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
    templateKey: template.key, revision: 1, title: template.title,
    instructions: template.instructions, estimatedMinutes: template.estimatedMinutes,
    requiredRoleIds: template.requiredRoleKeys,
    requiredRoleLabels: template.requiredRoleKeys.map((key) => roleNames.get(key) ?? 'Field team'),
    requiredCompetencyKeys: template.requiredCompetencyKeys,
    issueCategories: template.issueCategories, steps: template.steps.map(stepFromConfig),
  };
}

export function stillpointDemoOccurrences(
  brandId: string, locationId: string, now: Date,
): OperatorTaskOccurrence[] {
  return templates.map((template, index) => {
    const status = index < 2 ? 'scheduled' : index < 4 ? 'claimed' : 'completed';
    const actorName = status === 'scheduled' ? null : ACTORS[index] ?? 'Field team';
    return {
      id: IDS[index] ?? IDS[0], brandId, locationId, status,
      scheduledFor: instant(now, (index - 3) * 18),
      dueAt: instant(now, (index - 1) * 25), graceMinutes: 15,
      claimedBy: status === 'scheduled' ? null : `demo-member-${index}`,
      claimedAt: status === 'scheduled' ? null : instant(now, -20),
      claimExpiresAt: status === 'claimed' ? instant(now, 100) : null,
      completedAt: status === 'completed' ? instant(now, -(index - 3) * 12) : null,
      completedBy: status === 'completed' ? `demo-member-${index}` : null,
      completionNote: '', actorName, snapshot: snapshot(template, index),
      eligibility: { eligible: true, hasActiveShift: true, missingRoles: [], missingCompetencies: [] },
    };
  });
}
