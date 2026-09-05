'use server';

import { randomUUID } from 'node:crypto';

import { factoryTasks, parseOnboardingIntake } from '@platform/factory';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { start } from 'workflow/api';

import { currentSession, hasRole } from '@/lib/auth';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { serverClient } from '@/lib/supabase-server';
import { runPlatformFactory } from '@/workflows/platform-factory';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createOnboardingRun(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!hasRole(session, 'platform_admin')) redirect('/onboarding?error=forbidden');

  const parsed = parseOnboardingIntake({
    businessName: formData.get('businessName'),
    tenantSlug: formData.get('tenantSlug'),
    industryKey: formData.get('industryKey'),
    locationName: formData.get('locationName'),
    timezone: formData.get('timezone'),
    websiteUrl: formData.get('websiteUrl'),
  });
  if (!parsed.ok) redirect(`/onboarding?error=invalid&detail=${encodeURIComponent(parsed.issues[0] ?? '')}`);

  const signedClient = await serverClient();
  const environment = serverEnv();
  if (!signedClient || !environment) redirect('/onboarding?preview_created=1');

  const user = await signedClient.auth.getUser();
  if (!user.data.user) redirect('/login');

  const database = serviceDb(environment);
  const blueprint = await database.from('industry_blueprints').select('id')
    .eq('industry_key', parsed.value.industryKey).eq('status', 'active')
    .order('version', { ascending: false }).limit(1).maybeSingle<{ id: string }>();
  if (blueprint.error || !blueprint.data) redirect('/onboarding?error=blueprint');

  const result = await database.rpc('create_platform_onboarding_run', {
    input_blueprint_id: blueprint.data.id,
    input_business_name: parsed.value.businessName,
    input_tenant_slug: parsed.value.tenantSlug,
    input_location_name: parsed.value.locationName,
    input_timezone: parsed.value.timezone,
    input_website_url: parsed.value.websiteUrl ?? '',
    input_idempotency_key: randomUUID(),
    input_created_by: user.data.user.id,
    input_tasks: factoryTasks(),
  });
  if (result.error || typeof result.data !== 'string') redirect('/onboarding?error=create');

  try {
    await start(runPlatformFactory, [{ runId: result.data }]);
  } catch {
    await Promise.all([
      database.from('platform_onboarding_runs')
        .update({ state: 'failed', last_error_code: 'workflow_start_failed' }).eq('id', result.data),
      database.from('platform_onboarding_tasks')
        .update({ state: 'failed', last_error_code: 'workflow_start_failed' })
        .eq('run_id', result.data).eq('task_key', 'research-brand'),
    ]);
    redirect('/onboarding?error=automation');
  }

  revalidatePath('/onboarding');
  redirect('/onboarding?created=1');
}

export async function resumeOnboardingRun(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'platform_admin')) redirect('/onboarding?error=forbidden');
  const runId = String(formData.get('runId') ?? '').trim();
  if (!UUID.test(runId)) redirect('/onboarding?error=resume');
  const environment = serverEnv();
  if (!environment) redirect('/onboarding?error=resume');
  const database = serviceDb(environment);
  const run = await database.from('platform_onboarding_runs').select('id,state')
    .eq('id', runId).in('state', ['blocked', 'failed']).maybeSingle();
  if (run.error || !run.data) redirect('/onboarding?error=resume');
  try {
    await start(runPlatformFactory, [{ runId }]);
  } catch {
    await database.from('platform_onboarding_runs')
      .update({ state: 'failed', last_error_code: 'workflow_resume_failed' }).eq('id', runId);
    redirect('/onboarding?error=automation');
  }
  revalidatePath('/onboarding');
  redirect('/onboarding?resumed=1');
}
