import { createHash, createSign, randomBytes } from 'node:crypto';

import {
  dopplerProjectRequest,
  githubTemplateRequest,
  supabaseProjectRequest,
  vercelProjectSpecifications,
} from '@platform/factory';
import { createClient } from '@supabase/supabase-js';
import { sleep } from 'workflow';

import {
  availableFactoryCredentialKeys,
  buildFactoryApplicationManifest,
  parseBrandResearchArtifact,
  type BrandResearchArtifact,
  type FactoryRunInput,
} from '../lib/factory-automation';

type PlatformFactoryInput = { runId: string };
type FactoryRunRow = FactoryRunInput & { id: string; supabaseRegion: string };
type SafeResource = {
  provider: 'github' | 'doppler' | 'supabase' | 'vercel';
  kind: string;
  externalId: string;
  displayName: string;
  metadata?: Record<string, unknown>;
};

type ResponsesPayload = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

const RESEARCH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'logoSourceUrl', 'colors', 'sources'],
  properties: {
    summary: { type: 'string', minLength: 20, maxLength: 2000 },
    logoSourceUrl: { type: ['string', 'null'] },
    colors: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
    sources: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
  },
} as const;

function database() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Platform factory database is not configured.');
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => providerFetch(input, init ?? {}) },
  });
}

function logFactory(event: string, metadata: Record<string, unknown>): void {
  console.info(JSON.stringify({ severity: 'info', component: 'platform-factory', event, ...metadata }));
}

async function providerFetch(url: RequestInfo | URL, init: RequestInit): Promise<Response> {
  let failure: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
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

async function loadRun(runId: string): Promise<FactoryRunRow> {
  'use step';
  const result = await database().from('platform_onboarding_runs')
    .select('id, business_name, tenant_slug, location_name, website_url, industry_blueprints!inner(industry_key,supabase_region)')
    .eq('id', runId).single();
  if (result.error || !result.data) throw new Error(`Factory run lookup failed: ${result.error?.code ?? 'not_found'}`);
  const blueprint = result.data.industry_blueprints as unknown as { industry_key: string; supabase_region: string };
  return { id: result.data.id, businessName: result.data.business_name, tenantSlug: result.data.tenant_slug, locationName: result.data.location_name, websiteUrl: result.data.website_url ?? undefined, industryKey: blueprint.industry_key, supabaseRegion: blueprint.supabase_region };
}

async function synchronizeCredentials(runId: string): Promise<readonly string[]> {
  'use step';
  const available = availableFactoryCredentialKeys(process.env);
  await Promise.all(available.map(async (credentialKey) => {
    const result = await database().from('platform_credential_requirements').update({ state: 'connecting', secret_reference: `doppler://platform-factory/${credentialKey}` }).eq('run_id', runId).eq('credential_key', credentialKey).eq('state', 'required');
    if (result.error) throw new Error(`Credential metadata update failed: ${result.error.code}`);
  }));
  logFactory('credentials.synchronized', { runId, available: available.length });
  return available;
}

async function updateTask(runId: string, taskKey: string, state: string, errorCode: string | null = null): Promise<void> {
  'use step';
  const now = new Date().toISOString();
  const values = { state, last_error_code: errorCode, ...(state === 'running' ? { started_at: now } : {}), ...(state === 'completed' ? { completed_at: now } : {}) };
  const result = await database().from('platform_onboarding_tasks').update(values).eq('run_id', runId).eq('task_key', taskKey);
  if (result.error) throw new Error(`Factory task update failed: ${result.error.code}`);
  logFactory('task.updated', { runId, taskKey, state });
}

async function updateRun(runId: string, values: Record<string, unknown>): Promise<void> {
  'use step';
  const result = await database().from('platform_onboarding_runs').update(values).eq('id', runId);
  if (result.error) throw new Error(`Factory run update failed: ${result.error.code}`);
  logFactory('run.updated', { runId, state: values.state, stage: values.stage });
}

function responseText(payload: ResponsesPayload): string | null {
  return payload.output?.flatMap((entry) => entry.content ?? []).find((entry) => entry.type === 'output_text')?.text ?? null;
}

async function researchBrand(run: FactoryRunRow): Promise<BrandResearchArtifact> {
  'use step';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_RESEARCH_MODEL;
  if (!apiKey || !model) throw new Error('Research provider is not configured.');
  const response = await providerFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `platform-brand-${run.id}` },
    body: JSON.stringify({ model, tools: [{ type: 'web_search' }], input: `Research the public brand identity for ${run.businessName}, location ${run.locationName}${run.websiteUrl ? `, official website ${run.websiteUrl}` : ''}. Use authoritative sources. Return a concise factual summary, two to eight observed or conservative accessible brand colors, an HTTPS official logo URL only when verified, and exact HTTPS sources. Do not invent a logo, credential, address, or legal claim.`, text: { format: { type: 'json_schema', name: 'platform_brand_research', strict: true, schema: RESEARCH_SCHEMA } } }),
  });
  if (!response.ok) throw new Error(`Research provider rejected the request (${response.status}).`);
  const text = responseText(await response.json() as ResponsesPayload);
  const parsed = text ? parseBrandResearchArtifact(JSON.parse(text) as unknown) : null;
  if (!parsed) throw new Error('Research provider returned an invalid brand artifact.');
  return parsed;
}

async function saveArtifact(runId: string, kind: 'brand_kit' | 'application', manifest: Record<string, unknown>): Promise<void> {
  'use step';
  const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const result = await database().from('platform_artifact_manifests').upsert({ run_id: runId, artifact_kind: kind, version: 1, manifest, source_fingerprint: fingerprint, validation_state: 'valid' }, { onConflict: 'run_id,artifact_kind,version', ignoreDuplicates: true });
  if (result.error) throw new Error(`Factory artifact save failed: ${result.error.code}`);
  logFactory('artifact.saved', { runId, kind, fingerprint });
}

async function requiredCredentialKeys(runId: string): Promise<readonly string[]> {
  'use step';
  const result = await database().from('platform_credential_requirements').select('credential_key').eq('run_id', runId);
  if (result.error) throw new Error(`Credential gate failed: ${result.error.code}`);
  return (result.data ?? []).map((row) => row.credential_key);
}

async function verifyResearchCredential(runId: string): Promise<void> {
  'use step';
  const result = await database().from('platform_credential_requirements').update({ state: 'verified', verified_at: new Date().toISOString() }).eq('run_id', runId).eq('credential_key', 'openai.api_key');
  if (result.error) throw new Error(`Research credential verification failed: ${result.error.code}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Factory provider configuration is incomplete (${name}).`);
  return value;
}

async function providerJson<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw new Error(`${label} failed (${response.status}).`);
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`${label} returned an invalid response.`);
  }
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2026-03-10',
  };
}

function githubAppJwt(): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: requiredEnvironment('GITHUB_APP_ID') })).toString('base64url');
  const input = `${header}.${claims}`;
  const privateKey = requiredEnvironment('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey, 'base64url');
  return `${input}.${signature}`;
}

async function githubInstallationToken(): Promise<string> {
  const installationId = encodeURIComponent(requiredEnvironment('GITHUB_APP_INSTALLATION_ID'));
  const response = await providerFetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: githubHeaders(githubAppJwt()),
    body: JSON.stringify({ permissions: { administration: 'write', contents: 'read', metadata: 'read' } }),
  });
  const payload = await providerJson<{ token?: string }>(response, 'GitHub installation authentication');
  if (!payload.token) throw new Error('GitHub installation authentication returned no token.');
  return payload.token;
}

async function existingResource(runId: string, provider: string, kind: string): Promise<SafeResource | null> {
  const result = await database().from('platform_provisioned_resources')
    .select('provider, resource_kind, external_id, display_name, metadata')
    .eq('run_id', runId).eq('provider', provider).eq('resource_kind', kind).eq('state', 'ready').maybeSingle();
  if (result.error) throw new Error(`Factory resource lookup failed: ${result.error.code}`);
  if (!result.data) return null;
  return { provider: result.data.provider, kind: result.data.resource_kind, externalId: result.data.external_id, displayName: result.data.display_name, metadata: result.data.metadata } as SafeResource;
}

async function saveResource(runId: string, resource: SafeResource): Promise<void> {
  const result = await database().from('platform_provisioned_resources').upsert({
    run_id: runId, provider: resource.provider, resource_kind: resource.kind,
    environment: 'production', external_id: resource.externalId,
    display_name: resource.displayName, state: 'ready', metadata: resource.metadata ?? {},
    last_verified_at: new Date().toISOString(),
  }, { onConflict: 'provider,resource_kind,environment,external_id' });
  if (result.error) throw new Error(`Factory resource save failed: ${result.error.code}`);
}

async function verifyCredential(runId: string, credentialKey: string): Promise<void> {
  const result = await database().from('platform_credential_requirements')
    .update({ state: 'verified', verified_at: new Date().toISOString() })
    .eq('run_id', runId).eq('credential_key', credentialKey);
  if (result.error) throw new Error(`Factory credential verification failed: ${result.error.code}`);
}

async function provisionGitHub(run: FactoryRunRow): Promise<SafeResource> {
  'use step';
  const prior = await existingResource(run.id, 'github', 'repository');
  if (prior) return prior;
  const owner = requiredEnvironment('GITHUB_REPOSITORY_OWNER');
  const repository = `${owner}/${run.tenantSlug}`;
  const token = await githubInstallationToken();
  let response = await providerFetch(`https://api.github.com/repos/${repository}`, { headers: githubHeaders(token) });
  if (response.status === 404) {
    const templateOwner = encodeURIComponent(requiredEnvironment('GITHUB_TEMPLATE_OWNER'));
    const templateRepository = encodeURIComponent(requiredEnvironment('GITHUB_TEMPLATE_REPOSITORY'));
    response = await providerFetch(`https://api.github.com/repos/${templateOwner}/${templateRepository}/generate`, {
      method: 'POST', headers: githubHeaders(token), body: JSON.stringify(githubTemplateRequest(run.tenantSlug, owner)),
    });
  }
  const payload = await providerJson<{ full_name?: string; html_url?: string }>(response, 'GitHub repository provisioning');
  const resource: SafeResource = { provider: 'github', kind: 'repository', externalId: payload.full_name ?? repository, displayName: repository, metadata: { url: payload.html_url ?? `https://github.com/${repository}` } };
  await saveResource(run.id, resource);
  await verifyCredential(run.id, 'github.app');
  return resource;
}

function dopplerHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${requiredEnvironment('DOPPLER_SERVICE_ACCOUNT_TOKEN')}`, 'Content-Type': 'application/json' };
}

async function provisionDoppler(run: FactoryRunRow): Promise<SafeResource> {
  'use step';
  const prior = await existingResource(run.id, 'doppler', 'project');
  if (prior) return prior;
  const project = run.tenantSlug;
  let response = await providerFetch(`https://api.doppler.com/v3/projects/project?project=${encodeURIComponent(project)}`, { headers: dopplerHeaders() });
  if (response.status === 404) {
    response = await providerFetch('https://api.doppler.com/v3/projects', {
      method: 'POST', headers: dopplerHeaders(), body: JSON.stringify(dopplerProjectRequest(project)),
    });
  }
  const payload = await providerJson<{ id?: string; name?: string }>(response, 'Doppler project provisioning');
  const resource: SafeResource = { provider: 'doppler', kind: 'project', externalId: payload.id ?? project, displayName: payload.name ?? project, metadata: { project } };
  await saveResource(run.id, resource);
  await verifyCredential(run.id, 'doppler.service_token');
  return resource;
}

async function writeDopplerSecrets(project: string, secrets: Record<string, string>): Promise<void> {
  const config = process.env.DOPPLER_PRODUCTION_CONFIG?.trim() || 'prd';
  const response = await providerFetch('https://api.doppler.com/v3/configs/config/secrets', {
    method: 'POST', headers: dopplerHeaders(), body: JSON.stringify({ project, config, secrets }),
  });
  if (!response.ok) throw new Error(`Doppler secret synchronization failed (${response.status}).`);
}

async function readDopplerSecrets(project: string): Promise<Record<string, string>> {
  const config = process.env.DOPPLER_PRODUCTION_CONFIG?.trim() || 'prd';
  const query = new URLSearchParams({ project, config, format: 'json' });
  const response = await providerFetch(`https://api.doppler.com/v3/configs/config/secrets/download?${query}`, { headers: dopplerHeaders() });
  return providerJson<Record<string, string>>(response, 'Doppler runtime configuration lookup');
}

type SupabaseProject = { ref?: string; id?: string; name?: string; status?: string };

async function findSupabaseProject(name: string): Promise<SupabaseProject | null> {
  const organization = encodeURIComponent(requiredEnvironment('SUPABASE_ORGANIZATION_SLUG'));
  const token = requiredEnvironment('SUPABASE_MANAGEMENT_TOKEN');
  const response = await providerFetch(`https://api.supabase.com/v1/organizations/${organization}/projects?limit=100`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await providerJson<SupabaseProject[] | { projects?: SupabaseProject[] }>(response, 'Supabase project lookup');
  const projects = Array.isArray(payload) ? payload : payload.projects ?? [];
  return projects.find((project) => project.name === name) ?? null;
}

async function provisionSupabase(run: FactoryRunRow): Promise<SafeResource> {
  'use step';
  const prior = await existingResource(run.id, 'supabase', 'project');
  if (prior) return prior;
  let project = await findSupabaseProject(run.tenantSlug);
  const storedSecrets = project ? await readDopplerSecrets(run.tenantSlug) : {};
  const databasePassword = storedSecrets.SUPABASE_DB_PASSWORD ?? `${randomBytes(32).toString('base64url')}Aa1!`;
  if (!project) {
    await writeDopplerSecrets(run.tenantSlug, { SUPABASE_DB_PASSWORD: databasePassword });
    const token = requiredEnvironment('SUPABASE_MANAGEMENT_TOKEN');
    const body = supabaseProjectRequest(run.tenantSlug, requiredEnvironment('SUPABASE_ORGANIZATION_SLUG'), run.supabaseRegion, databasePassword);
    const response = await providerFetch('https://api.supabase.com/v1/projects', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    project = await providerJson<SupabaseProject>(response, 'Supabase project provisioning');
  } else if (!storedSecrets.SUPABASE_DB_PASSWORD) {
    throw new Error('Existing Supabase project is missing its managed database-password reference.');
  }
  const reference = project.ref ?? project.id;
  if (!reference) throw new Error('Supabase project provisioning returned no reference.');
  const resource: SafeResource = { provider: 'supabase', kind: 'project', externalId: reference, displayName: project.name ?? run.tenantSlug, metadata: { region: run.supabaseRegion, status: project.status ?? 'creating' } };
  await saveResource(run.id, resource);
  await verifyCredential(run.id, 'supabase.management_token');
  return resource;
}

async function synchronizeSupabaseRuntime(run: FactoryRunRow, reference: string): Promise<boolean> {
  'use step';
  const token = requiredEnvironment('SUPABASE_MANAGEMENT_TOKEN');
  const response = await providerFetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(reference)}/api-keys`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404 || response.status === 409 || response.status === 423) return false;
  const keys = await providerJson<Array<{ name?: string; api_key?: string }>>(response, 'Supabase runtime credential lookup');
  const publishable = keys.find((key) => key.name === 'publishable')?.api_key ?? keys.find((key) => key.name === 'anon')?.api_key;
  const serviceRole = keys.find((key) => key.name === 'secret')?.api_key ?? keys.find((key) => key.name === 'service_role')?.api_key;
  if (!publishable || !serviceRole) return false;
  await writeDopplerSecrets(run.tenantSlug, { SUPABASE_URL: `https://${reference}.supabase.co`, SUPABASE_PUBLISHABLE_KEY: publishable, SUPABASE_SERVICE_ROLE_KEY: serviceRole });
  return true;
}

function vercelScopeQuery(): string {
  const scope = requiredEnvironment('VERCEL_SCOPE');
  return new URLSearchParams(scope.startsWith('team_') ? { teamId: scope } : { slug: scope }).toString();
}

function vercelHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${requiredEnvironment('VERCEL_TOKEN')}`, 'Content-Type': 'application/json' };
}

function vercelVariables(surface: string, tenantSlug: string, secrets: Record<string, string>): Array<Record<string, unknown>> {
  const hqUrl = `https://${tenantSlug}-hq.vercel.app`;
  const shared = surface === 'hq'
    ? { SUPABASE_URL: secrets.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL: secrets.SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: secrets.SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY: secrets.SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET: secrets.CRON_SECRET }
    : surface === 'display'
      ? { NEXT_PUBLIC_SUPABASE_URL: secrets.SUPABASE_URL }
      : { EXPO_PUBLIC_SUPABASE_URL: secrets.SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secrets.SUPABASE_PUBLISHABLE_KEY, EXPO_PUBLIC_API_URL: hqUrl, EXPO_PUBLIC_ALLOWED_API_HOST: `${tenantSlug}-hq.vercel.app`, TENANT: tenantSlug };
  return Object.entries(shared).flatMap(([key, value]) => value ? [{ key, value, target: ['production', 'preview'], type: key.includes('SERVICE_ROLE') || key === 'CRON_SECRET' ? 'encrypted' : 'plain' }] : []);
}

async function createVercelProject(specification: ReturnType<typeof vercelProjectSpecifications>[number], variables: Array<Record<string, unknown>>): Promise<{ id?: string; name?: string; link?: { repo?: string } }> {
  const scope = vercelScopeQuery();
  let response = await providerFetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(specification.name)}?${scope}`, { headers: vercelHeaders() });
  if (response.status === 404) {
    const body = { name: specification.name, rootDirectory: specification.rootDirectory, gitRepository: { type: 'github', repo: specification.repository }, environmentVariables: variables, ...(specification.framework ? { framework: specification.framework } : {}) };
    response = await providerFetch(`https://api.vercel.com/v11/projects?${scope}`, { method: 'POST', headers: vercelHeaders(), body: JSON.stringify(body) });
  }
  return providerJson(response, `Vercel project provisioning for ${specification.name}`);
}

async function provisionVercel(run: FactoryRunRow, repository: string): Promise<readonly SafeResource[]> {
  'use step';
  const secrets = await readDopplerSecrets(run.tenantSlug);
  if (!secrets.SUPABASE_URL || !secrets.SUPABASE_PUBLISHABLE_KEY || !secrets.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase runtime configuration is not ready for deployment.');
  }
  if (!secrets.CRON_SECRET) {
    secrets.CRON_SECRET = randomBytes(32).toString('base64url');
    await writeDopplerSecrets(run.tenantSlug, { CRON_SECRET: secrets.CRON_SECRET });
  }
  const resources: SafeResource[] = [];
  for (const specification of vercelProjectSpecifications(run.tenantSlug, repository)) {
    const kind = `project-${specification.name.slice(run.tenantSlug.length + 1)}`;
    const prior = await existingResource(run.id, 'vercel', kind);
    if (prior) { resources.push(prior); continue; }
    const project = await createVercelProject(specification, vercelVariables(kind.slice(8), run.tenantSlug, secrets));
    const resource: SafeResource = { provider: 'vercel', kind, externalId: project.id ?? specification.name, displayName: project.name ?? specification.name, metadata: { url: `https://${specification.name}.vercel.app`, repository: project.link?.repo ?? repository } };
    await saveResource(run.id, resource);
    resources.push(resource);
  }
  await verifyCredential(run.id, 'vercel.token');
  return resources;
}

async function failRun(runId: string, message: string): Promise<void> {
  'use step';
  logFactory('run.failed', { runId, message });
  const result = await database().from('platform_onboarding_runs').update({ state: 'failed', last_error_code: 'factory_pipeline_failed' }).eq('id', runId);
  if (result.error) throw new Error(`Factory failure state update failed: ${result.error.code}`);
}

async function createDemo(run: FactoryRunRow): Promise<void> {
  let activeTask = 'research-brand';
  try {
    await updateTask(run.id, activeTask, 'running');
    const research = await researchBrand(run);
    await saveArtifact(run.id, 'brand_kit', research as unknown as Record<string, unknown>);
    await verifyResearchCredential(run.id);
    await updateTask(run.id, activeTask, 'completed');
    activeTask = 'generate-demo';
    await updateTask(run.id, activeTask, 'running');
    await saveArtifact(run.id, 'application', buildFactoryApplicationManifest(run, research));
    await updateTask(run.id, activeTask, 'completed');
    await updateTask(run.id, 'verify-demo', 'completed');
  } catch (error) {
    await updateTask(run.id, activeTask, 'failed', 'factory_task_failed');
    throw error;
  }
}

async function provisionHostedInfrastructure(run: FactoryRunRow): Promise<void> {
  let activeTask = 'create-github-repository';
  try {
    await updateTask(run.id, activeTask, 'running');
    const repository = await provisionGitHub(run);
    await updateTask(run.id, activeTask, 'completed');
    activeTask = 'create-doppler-project';
    await updateTask(run.id, activeTask, 'running');
    await provisionDoppler(run);
    await updateTask(run.id, activeTask, 'completed');
    activeTask = 'create-supabase-project';
    await updateTask(run.id, activeTask, 'running');
    const supabase = await provisionSupabase(run);
    let runtimeReady = false;
    for (let poll = 0; poll < 30 && !runtimeReady; poll += 1) {
      if (poll > 0) await sleep('10s');
      runtimeReady = await synchronizeSupabaseRuntime(run, supabase.externalId);
    }
    if (!runtimeReady) throw new Error('Supabase project did not become ready within five minutes.');
    await updateTask(run.id, activeTask, 'completed');
    activeTask = 'create-vercel-projects';
    await updateTask(run.id, activeTask, 'running');
    await provisionVercel(run, repository.externalId);
    await updateTask(run.id, activeTask, 'completed');
  } catch (error) {
    await updateTask(run.id, activeTask, 'failed', 'factory_task_failed');
    throw error;
  }
}

export async function runPlatformFactory(input: PlatformFactoryInput): Promise<{ status: 'blocked' | 'infrastructure_ready'; missingCredentialKeys: readonly string[] }> {
  'use workflow';
  try {
    const run = await loadRun(input.runId);
    const available = await synchronizeCredentials(run.id);
    if (!available.includes('openai.api_key')) {
      await updateTask(run.id, 'research-brand', 'blocked', 'research_setup_required');
      await updateRun(run.id, { state: 'blocked', stage: 'credentials', last_error_code: 'research_setup_required' });
      return { status: 'blocked', missingCredentialKeys: ['openai.api_key'] };
    }
    await createDemo(run);
    const required = await requiredCredentialKeys(run.id);
    const missing = required.filter((credentialKey) => !available.includes(credentialKey));
    if (missing.length > 0) {
      await updateTask(run.id, 'collect-credentials', 'blocked', 'provider_access_required');
      await updateRun(run.id, { state: 'blocked', stage: 'credentials', last_error_code: 'provider_access_required' });
      return { status: 'blocked', missingCredentialKeys: missing };
    }
    await updateTask(run.id, 'collect-credentials', 'completed');
    await updateRun(run.id, { state: 'running', stage: 'infrastructure', last_error_code: null });
    await provisionHostedInfrastructure(run);
    await updateTask(run.id, 'publish-content', 'blocked', 'content_bootstrap_required');
    await updateRun(run.id, { state: 'blocked', stage: 'content', last_error_code: 'content_bootstrap_required' });
    return { status: 'infrastructure_ready', missingCredentialKeys: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Platform factory failed.';
    await failRun(input.runId, message);
    throw error;
  }
}
