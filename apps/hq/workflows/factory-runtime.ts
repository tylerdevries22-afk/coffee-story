import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { availableFactoryCredentialKeys, type FactoryRunInput } from '../lib/factory-automation';
import { factorySurfacePlan } from '../lib/factory-surfaces';
export type FactoryRunRow = FactoryRunInput & { id: string; supabaseRegion: string };
export type SafeResource = {
  provider: 'github' | 'doppler' | 'supabase' | 'vercel';
  kind: string;
  environment?: 'production';
  externalId: string;
  displayName: string;
  metadata?: Record<string, unknown>;
};
export async function providerFetch(
  url: RequestInfo | URL,
  init: RequestInit,
  idempotent = false,
): Promise<Response> {
  let failure: Error | null = null;
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  const retrySafe = idempotent
    || ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method)
    || headers.has('Idempotency-Key');
  for (let attempt = 1; attempt <= (retrySafe ? 2 : 1); attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      failure = new Error(`Provider returned ${response.status}.`);
    } catch (error) {
      failure = error instanceof Error ? error : new Error('Provider request failed.');
    }
  }
  throw failure ?? new Error('Provider request failed.');
}
export function database() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Platform factory database is not configured.');
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => providerFetch(input, init ?? {}) },
  });
}
export function logFactory(event: string, metadata: Record<string, unknown>): void {
  console.info(JSON.stringify({ severity: 'info', component: 'platform-factory', event, ...metadata }));
}
export async function loadRun(runId: string): Promise<FactoryRunRow> {
  'use step';
  const result = await database().from('platform_onboarding_runs')
    .select('id, business_name, tenant_slug, location_name, website_url, industry_blueprints!inner(industry_key,supabase_region,manifest)')
    .eq('id', runId).single();
  if (result.error || !result.data) {
    throw new Error(`Factory run lookup failed: ${result.error?.code ?? 'not_found'}`);
  }
  const blueprint = result.data.industry_blueprints as unknown as {
    industry_key: string;
    supabase_region: string;
    manifest: unknown;
  };
  const surfaces = factorySurfacePlan(blueprint.industry_key, blueprint.manifest).all;
  return {
    id: result.data.id,
    businessName: result.data.business_name,
    tenantSlug: result.data.tenant_slug,
    locationName: result.data.location_name,
    websiteUrl: result.data.website_url ?? undefined,
    industryKey: blueprint.industry_key,
    supabaseRegion: blueprint.supabase_region,
    surfaces,
  };
}
export async function synchronizeCredentials(runId: string): Promise<readonly string[]> {
  'use step';
  const available = availableFactoryCredentialKeys(process.env);
  await Promise.all(available.map(async (credentialKey) => {
    const result = await database().from('platform_credential_requirements')
      .update({ state: 'connecting', secret_reference: `doppler://platform-factory/${credentialKey}` })
      .eq('run_id', runId).eq('credential_key', credentialKey).eq('state', 'required');
    if (result.error) throw new Error(`Credential metadata update failed: ${result.error.code}`);
  }));
  logFactory('credentials.synchronized', { runId, available: available.length });
  return available;
}
export async function updateTask(
  runId: string,
  taskKey: string,
  state: string,
  errorCode: string | null = null,
): Promise<void> {
  'use step';
  const now = new Date().toISOString();
  const values = {
    state,
    last_error_code: errorCode,
    ...(state === 'running' ? { started_at: now } : {}),
    ...(state === 'completed' ? { completed_at: now } : {}),
  };
  const result = await database().from('platform_onboarding_tasks')
    .update(values).eq('run_id', runId).eq('task_key', taskKey);
  if (result.error) throw new Error(`Factory task update failed: ${result.error.code}`);
  logFactory('task.updated', { runId, taskKey, state });
}
export async function updateRun(runId: string, values: Record<string, unknown>): Promise<void> {
  'use step';
  const update = values.state === 'live'
    ? { ...values, completed_at: new Date().toISOString() } : values;
  const result = await database().from('platform_onboarding_runs').update(update).eq('id', runId);
  if (result.error) throw new Error(`Factory run update failed: ${result.error.code}`);
  logFactory('run.updated', { runId, state: values.state, stage: values.stage });
}
export async function saveArtifact(
  runId: string,
  kind: 'brand_kit' | 'catalog' | 'training' | 'media' | 'application' | 'deployment',
  manifest: Record<string, unknown>,
  version = 1,
): Promise<void> {
  'use step';
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const result = await database().from('platform_artifact_manifests').upsert({
    run_id: runId,
    artifact_kind: kind,
    version,
    manifest,
    source_fingerprint: fingerprint,
    validation_state: 'valid',
  }, { onConflict: 'run_id,artifact_kind,version', ignoreDuplicates: true });
  if (result.error) throw new Error(`Factory artifact save failed: ${result.error.code}`);
  logFactory('artifact.saved', { runId, kind, fingerprint });
}

export async function requiredCredentialKeys(runId: string): Promise<readonly string[]> {
  'use step';
  const result = await database().from('platform_credential_requirements')
    .select('credential_key').eq('run_id', runId);
  if (result.error) throw new Error(`Credential gate failed: ${result.error.code}`);
  return (result.data ?? []).map((row) => row.credential_key);
}

export async function verifyCredential(runId: string, credentialKey: string): Promise<void> {
  const result = await database().from('platform_credential_requirements')
    .update({ state: 'verified', verified_at: new Date().toISOString() })
    .eq('run_id', runId).eq('credential_key', credentialKey);
  if (result.error) throw new Error(`Factory credential verification failed: ${result.error.code}`);
}

export async function existingResource(
  runId: string,
  provider: string,
  kind: string,
): Promise<SafeResource | null> {
  const result = await database().from('platform_provisioned_resources')
    .select('provider, resource_kind, environment, external_id, display_name, metadata')
    .eq('run_id', runId).eq('provider', provider).eq('resource_kind', kind)
    .eq('state', 'ready').maybeSingle();
  if (result.error) throw new Error(`Factory resource lookup failed: ${result.error.code}`);
  if (!result.data) return null;
  if (result.data.environment !== 'production') {
    throw new Error('Factory resource environment does not match production.');
  }
  return {
    provider: result.data.provider,
    kind: result.data.resource_kind,
    environment: 'production',
    externalId: result.data.external_id,
    displayName: result.data.display_name,
    metadata: result.data.metadata,
  } as SafeResource;
}

export async function saveResource(runId: string, resource: SafeResource): Promise<void> {
  const result = await database().from('platform_provisioned_resources').upsert({
    run_id: runId,
    provider: resource.provider,
    resource_kind: resource.kind,
    environment: resource.environment ?? 'production',
    external_id: resource.externalId,
    display_name: resource.displayName,
    state: 'ready',
    metadata: resource.metadata ?? {},
    last_verified_at: new Date().toISOString(),
  }, { onConflict: 'provider,resource_kind,environment,external_id' });
  if (result.error) throw new Error(`Factory resource save failed: ${result.error.code}`);
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Factory provider configuration is incomplete (${name}).`);
  return value;
}

export async function providerJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(`${label} failed (${response.status}).`);
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`${label} returned an invalid response.`);
  }
}
