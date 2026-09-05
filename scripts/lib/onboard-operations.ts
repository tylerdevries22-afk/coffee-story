import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantOperationsConfig } from '@platform/schema';

import {
  requiredOperationId,
  seedOperationCompetencies,
  seedOperationRoles,
  seedOperationTemplates,
} from './onboard-operation-resources.js';

async function seedSchedules(
  db: SupabaseClient, brandId: string, locationId: string, timezone: string,
  config: TenantOperationsConfig, templateIds: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const schedule of config.schedules) {
    const rule = schedule.rule;
    const { data, error } = await db.from('operation_schedules').upsert({
      brand_id: brandId, location_id: locationId, schedule_key: schedule.key,
      template_id: requiredOperationId(templateIds, schedule.templateKey, 'template'), timezone,
      schedule_kind: rule.kind,
      recurrence_rule: rule.weekdays.length === 7 ? 'daily' : 'weekly',
      weekdays: rule.weekdays,
      local_start_time: rule.kind === 'fixed_time' ? rule.localTime : null,
      anchor_offset_minutes: rule.kind === 'opening_offset' || rule.kind === 'closing_offset'
        ? rule.offsetMinutes : rule.kind === 'open_interval' ? rule.startOffsetMinutes : null,
      interval_minutes: rule.kind === 'open_interval' ? rule.intervalMinutes : null,
      interval_end_offset_minutes: rule.kind === 'open_interval' ? rule.endOffsetMinutes : null,
      due_window_minutes: schedule.dueWindowMinutes, grace_minutes: schedule.graceMinutes,
      active_from: schedule.activeFrom ?? '1970-01-01', active_until: schedule.activeUntil,
      is_enabled: schedule.enabled, managed_by_config: true,
    }, { onConflict: 'brand_id,location_id,schedule_key' }).select('id').single();
    if (error) throw error;
    ids.set(schedule.key, data.id);
  }
  return ids;
}

async function seedEscalations(
  db: SupabaseClient, brandId: string, config: TenantOperationsConfig,
  scheduleIds: ReadonlyMap<string, string>,
): Promise<void> {
  for (const escalation of config.escalations) {
    const saved = await db.from('operation_escalation_rules').upsert({
      brand_id: brandId,
      schedule_id: escalation.scheduleKey
        ? requiredOperationId(scheduleIds, escalation.scheduleKey, 'schedule') : null,
      escalation_order: escalation.order, offset_minutes: escalation.offsetMinutes,
      recipient_role: escalation.recipientRole, channels: escalation.channels,
      is_active: true, managed_by_config: true,
    }, { onConflict: 'brand_id,schedule_id,escalation_order' });
    if (saved.error) throw saved.error;
  }
}

export async function seedTenantOperations(
  db: SupabaseClient, brandId: string,
  locations: readonly { readonly id: string; readonly timezone: string }[],
  config: TenantOperationsConfig,
): Promise<void> {
  const disables = [
    db.from('workforce_roles').update({ is_active: false })
      .eq('brand_id', brandId).eq('managed_by_operations_config', true),
    db.from('training_competencies').update({ is_active: false })
      .eq('brand_id', brandId).eq('managed_by_config', true),
    db.from('operation_task_templates').update({ is_active: false })
      .eq('brand_id', brandId).eq('managed_by_config', true),
    db.from('operation_schedules').update({ is_enabled: false })
      .eq('brand_id', brandId).eq('managed_by_config', true),
    db.from('operation_escalation_rules').update({ is_active: false })
      .eq('brand_id', brandId).eq('managed_by_config', true),
  ];
  for (const pending of disables) {
    const result = await pending;
    if (result.error) throw result.error;
  }
  const roleIds = await seedOperationRoles(db, brandId, config);
  await seedOperationCompetencies(db, brandId, config);
  const templateIds = await seedOperationTemplates(db, brandId, config, roleIds);
  for (const location of locations) {
    const scheduleIds = await seedSchedules(
      db, brandId, location.id, location.timezone, config, templateIds,
    );
    await seedEscalations(db, brandId, config, scheduleIds);
  }
  const retention = await db.from('operation_retention_policies').upsert({
    brand_id: brandId, evidence_days: config.retention.evidenceDays,
    issue_days: config.retention.issueDays,
    actor_identity_days: config.retention.actorIdentityDays,
  }, { onConflict: 'brand_id' });
  if (retention.error) throw retention.error;
}
