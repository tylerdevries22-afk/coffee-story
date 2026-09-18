/**
 * Starting, reusing or restarting the factory run behind a new organization.
 *
 * Lifted out of the organizations server action, which passed the 200-line cap
 * once the new-shop wizard began writing a tenant pack. The action is the form
 * boundary -- parse, authorize, respond -- and this is the provisioning state
 * machine it delegates to, which is the same split `organization-provisioning-helpers`
 * already makes.
 */
import { start } from 'workflow/api';

import type { serviceDb } from '@/lib/api-auth';
import { holdIfFactoryFull } from '@/lib/factory-capacity';
import { onboardingRunArgs } from '@/lib/factory-run-input';
import { factoryStartupDecision } from '@/lib/factory-startup';
import type { OrgDraft } from '@/lib/org-input';
import { runPlatformFactory } from '@/workflows/platform-factory';

export async function startFactoryRun(input: {
  database: ReturnType<typeof serviceDb>;
  actorId: string;
  idempotencyKey: string;
  draft: OrgDraft;
}): Promise<boolean> {
  const { database, actorId, idempotencyKey, draft } = input;
  const existing = await database.from('platform_onboarding_runs').select('id,state')
    .eq('tenant_slug', draft.slug).maybeSingle<{ id: string; state: string }>();
  if (existing.error) throw new Error('Factory run lookup failed.');
  const decision = factoryStartupDecision(existing.data);
  if (decision === 'reuse') return true;
  if (decision === 'reject') return false;
  if (decision === 'restart' && existing.data) {
    const claim = await database.from('platform_onboarding_runs')
      .update({ state: 'running', last_error_code: null }).eq('id', existing.data.id)
      .eq('state', existing.data.state).select('id').maybeSingle<{ id: string }>();
    if (claim.error) throw new Error('Factory run restart failed.');
    if (!claim.data) return true;
  }
  let runId = existing.data?.id;
  if (!runId) {
    const blueprint = await database.from('industry_blueprints').select('id')
      .eq('industry_key', draft.industryKey).eq('status', 'active')
      .order('version', { ascending: false }).limit(1).single<{ id: string }>();
    if (blueprint.error) throw new Error('Factory blueprint is unavailable.');
    const run = await database.rpc('create_platform_onboarding_run', onboardingRunArgs(draft, {
      blueprintId: blueprint.data.id, idempotencyKey, actorId,
    }));
    if (run.error || typeof run.data !== 'string') throw new Error('Factory run creation failed.');
    runId = run.data;
  }
  try {
    // At the concurrency limit the run waits as factory_busy and the scheduled
    // job starts it when a slot frees; the organization is created either way.
    if (await holdIfFactoryFull(database, runId)) return true;
    await start(runPlatformFactory, [{ runId }]);
  } catch {
    await database.from('platform_onboarding_runs').update({
      state: 'failed', last_error_code: 'workflow_start_failed',
    }).eq('id', runId);
    return false;
  }
  return true;
}
