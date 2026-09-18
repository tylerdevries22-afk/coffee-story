'use server';

import { searchPlaceIds } from '@platform/engine';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession, hasRole } from '@/lib/auth';
import { createDemoBatch, stopDemoBatch, updateDemoSettings, type DemoSettingsPatch } from '@/lib/demo-factory/batches';
import { demoFactoryReadiness } from '@/lib/demo-factory/console-data';
import { parseDemoBatchInput, parseDemoLimitsInput } from '@/lib/demo-factory/console-input';
import { log } from '@/lib/log';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';

/** Per caller per minute. Each of these is an operator's decision, not a stream. */
const ACTION_LIMIT = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Throttle first, then the role: a flood should cost this instance a map
 * entry, not a GoTrue round trip. Only a platform admin runs the factory --
 * it spends money and it writes to businesses that did not ask.
 */
async function platformAdmin(action: string): Promise<string | null> {
  if (rateLimited(clientIdentity({ headers: await headers() }), `demos:${action}`, Date.now(), ACTION_LIMIT)) {
    redirect('/demos?error=rate_limited');
  }
  const session = await currentSession();
  if (!session || !hasRole(session, 'platform_admin')) redirect('/demos?error=forbidden');
  return session.userId || null;
}

function invalid(message: string): never {
  redirect(`/demos?error=invalid&detail=${encodeURIComponent(message)}`);
}

export async function startDemoBatch(formData: FormData): Promise<void> {
  const userId = await platformAdmin('batch');
  const parsed = parseDemoBatchInput(formData.get('query'), formData.get('count'));
  if (!parsed.ok) invalid(parsed.message);
  const env = serverEnv();
  if (!env) redirect('/demos?error=unconfigured');
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  // US only: the region biases the search, and the runner checks the address
  // Place Details returns before it builds anything.
  const result = await createDemoBatch(
    serviceDb(env),
    (query, limit) => searchPlaceIds(query, { apiKey }, { regionCode: 'US' }, limit),
    parsed.value,
    userId,
  );
  if (result.kind === 'failed') redirect(`/demos?error=${result.code}`);
  revalidatePath('/demos');
  redirect(`/demos?found=${result.found}&queued=${result.queued}`);
}

export async function stopBatch(formData: FormData): Promise<void> {
  await platformAdmin('stop');
  const batchId = String(formData.get('batchId') ?? '');
  if (!UUID.test(batchId)) invalid('That batch could not be found.');
  const env = serverEnv();
  if (!env) redirect('/demos?error=unconfigured');
  let skipped = 0;
  try {
    skipped = await stopDemoBatch(serviceDb(env), batchId);
  } catch (error) {
    log.error('demo_factory.batch_stop_failed', { batchId }, error);
    redirect('/demos?error=database');
  }
  revalidatePath('/demos');
  redirect(`/demos?stopped=${skipped}`);
}

async function saveSettings(patch: DemoSettingsPatch, userId: string | null, notice: string): Promise<never> {
  const env = serverEnv();
  if (!env) redirect('/demos?error=unconfigured');
  try {
    await updateDemoSettings(serviceDb(env), patch, userId);
  } catch (error) {
    log.error('demo_factory.settings_failed', {}, error);
    redirect('/demos?error=database');
  }
  revalidatePath('/demos');
  redirect(`/demos?${notice}`);
}

/**
 * The kill switch. Off takes effect at the next claim: jobs already being
 * built finish, because their calls are already paid for. On is refused
 * until a run could succeed -- without a Places key every job would fail, and
 * without a builder name no demo could be shown.
 */
export async function switchDemoFactory(formData: FormData): Promise<void> {
  const userId = await platformAdmin('switch');
  const enabled = formData.get('enabled') === 'on';
  const readiness = demoFactoryReadiness();
  if (enabled && !(readiness.placesKey && readiness.builderName)) redirect('/demos?error=not_ready');
  await saveSettings({ enabled }, userId, enabled ? 'switched=on' : 'switched=off');
}

export async function saveDemoLimits(formData: FormData): Promise<void> {
  const userId = await platformAdmin('limits');
  const parsed = parseDemoLimitsInput(formData.get('dailyLimit'), formData.get('dailyBudget'));
  if (!parsed.ok) invalid(parsed.message);
  await saveSettings(parsed.value, userId, 'saved=1');
}
