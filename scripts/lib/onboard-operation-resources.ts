import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantOperationsConfig } from '@platform/schema';

export function requiredOperationId(
  ids: ReadonlyMap<string, string>, key: string, label: string,
): string {
  const id = ids.get(key);
  if (!id) throw new Error(`Operations seed could not resolve ${label} "${key}".`);
  return id;
}

export async function seedOperationRoles(
  db: SupabaseClient, brandId: string, config: TenantOperationsConfig,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [index, role] of config.roles.entries()) {
    const { data, error } = await db.from('workforce_roles').upsert({
      brand_id: brandId, slug: role.key, name: role.title,
      description: role.description, sort_order: index, is_active: true,
      managed_by_operations_config: true,
    }, { onConflict: 'brand_id,slug' }).select('id').single();
    if (error) throw error;
    ids.set(role.key, data.id);
  }
  return ids;
}

export async function seedOperationCompetencies(
  db: SupabaseClient, brandId: string, config: TenantOperationsConfig,
): Promise<void> {
  for (const competency of config.competencies) {
    const { error } = await db.from('training_competencies').upsert({
      brand_id: brandId, competency_key: competency.key, title: competency.title,
      renewal_days: competency.renewalDays, is_active: true, managed_by_config: true,
    }, { onConflict: 'brand_id,competency_key' });
    if (error) throw error;
  }
}

async function seedOperationSteps(
  db: SupabaseClient, brandId: string, templateId: string,
  steps: TenantOperationsConfig['templates'][number]['steps'],
): Promise<void> {
  const { data: existing, error } = await db.from('operation_task_steps')
    .select('step_key').eq('brand_id', brandId).eq('template_id', templateId);
  if (error) throw error;
  const configured = new Set(steps.map((step) => step.key));
  const removed = (existing ?? []).map((step) => step.step_key).filter((key) => !configured.has(key));
  if (removed.length > 0) {
    const deletion = await db.from('operation_task_steps').delete()
      .eq('brand_id', brandId).eq('template_id', templateId).in('step_key', removed);
    if (deletion.error) throw deletion.error;
  }
  for (const [index, step] of steps.entries()) {
    const saved = await db.from('operation_task_steps').upsert({
      brand_id: brandId, template_id: templateId, step_key: step.key,
      title: step.title, instructions: step.instructions, response_kind: step.responseKind,
      is_required: step.required, issue_on_failure: step.issueOnFailure,
      allow_not_applicable: step.allowNotApplicable,
      constraints: step.constraints, sort_order: index,
    }, { onConflict: 'template_id,step_key' });
    if (saved.error) throw saved.error;
  }
}

export async function seedOperationTemplates(
  db: SupabaseClient, brandId: string, config: TenantOperationsConfig,
  roleIds: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const template of config.templates) {
    const { data, error } = await db.from('operation_task_templates').upsert({
      brand_id: brandId, location_id: null, template_key: template.key,
      program_key: template.programKey, routine_kind: template.routineKind,
      revision: template.revision, title: template.title, instructions: template.instructions,
      estimated_minutes: template.estimatedMinutes,
      required_role_ids: template.requiredRoleKeys.map(
        (key) => requiredOperationId(roleIds, key, 'role'),
      ),
      required_competency_keys: template.requiredCompetencyKeys,
      evidence_policy: { issueCategories: template.issueCategories },
      is_active: true, managed_by_config: true,
    }, { onConflict: 'brand_id,location_id,template_key,revision' }).select('id').single();
    if (error) throw error;
    await seedOperationSteps(db, brandId, data.id, template.steps);
    ids.set(template.key, data.id);
  }
  return ids;
}
