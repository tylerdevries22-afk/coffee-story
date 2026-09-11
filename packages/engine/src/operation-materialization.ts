import {
  dueEscalations,
  type EscalationRule,
  type OperationTemplateSnapshot,
} from '@platform/domain';

export type MaterializableOperation = {
  scheduleId: string;
  brandId: string;
  locationId: string;
  templateId: string;
  templateSnapshot: OperationTemplateSnapshot;
  scheduledFor: string;
  dueAt: string;
  graceMinutes: number;
};

export function operationMaterializationKey(input: MaterializableOperation): string {
  const scheduledAt = Date.parse(input.scheduledFor);
  if (!Number.isFinite(scheduledAt)) throw new RangeError('scheduledFor must be a valid timestamp.');
  return `${input.scheduleId}:${Math.floor(scheduledAt / 1_000)}`;
}

export function operationOccurrenceInsert(input: MaterializableOperation, now = new Date()) {
  const scheduledAt = Date.parse(input.scheduledFor);
  const dueAt = Date.parse(input.dueAt);
  if (!Number.isFinite(dueAt) || dueAt <= scheduledAt) {
    throw new RangeError('dueAt must be after scheduledFor.');
  }
  if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 0 || input.graceMinutes > 1_440) {
    throw new RangeError('graceMinutes must be an integer from 0 through 1440.');
  }
  return {
    brand_id: input.brandId,
    location_id: input.locationId,
    schedule_id: input.scheduleId,
    template_id: input.templateId,
    source: 'schedule' as const,
    materialization_key: operationMaterializationKey(input),
    template_snapshot: input.templateSnapshot,
    scheduled_for: input.scheduledFor,
    due_at: input.dueAt,
    grace_minutes: input.graceMinutes,
    status: 'scheduled' as const,
  };
}

export type EscalationCandidate = EscalationRule & {
  recipientRole: 'eligible_staff' | 'location_manager' | 'brand_owner';
  channels: readonly ('in_app' | 'push')[];
};

export function operationEscalationsToCreate(
  dueAt: string,
  rules: readonly EscalationCandidate[],
  existingRuleIds: ReadonlySet<string>,
  now: Date,
): EscalationCandidate[] {
  const dueIds = new Set(dueEscalations(dueAt, rules, existingRuleIds, now).map((rule) => rule.id));
  return rules.filter((rule) => dueIds.has(rule.id));
}
