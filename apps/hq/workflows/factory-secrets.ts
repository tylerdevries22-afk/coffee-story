import { randomBytes } from 'node:crypto';

import { dopplerProjectRequest, supabaseProjectRequest } from '@platform/factory';

import { createOrAdopt } from '../lib/provider-create';
import { verifyAdoption, verifyExistingAdoption } from './factory-provider-adoption';
import {
  existingResource,
  logFactory,
  providerFetch,
  providerJson,
  requiredEnvironment,
  saveResource,
  verifyCredential,
  type FactoryRunRow,
  type SafeResource,
} from './factory-runtime';
import {
  supabaseProjectFromLookup,
  verifiedDopplerResource,
  verifiedSupabaseResource,
} from './factory-secret-adoption';

function dopplerHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requiredEnvironment('DOPPLER_SERVICE_ACCOUNT_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

export async function provisionDoppler(run: FactoryRunRow): Promise<SafeResource> {
  'use step';
  const project = run.tenantSlug;
  const lookup = async (): Promise<unknown | null> => {
    const found = await providerFetch(
      `https://api.doppler.com/v3/projects/project?project=${encodeURIComponent(project)}`,
      { headers: dopplerHeaders() },
    );
    return found.status === 404
      ? null
      : providerJson<unknown>(found, 'Doppler project lookup');
  };
  const prior = await existingResource(run.id, 'doppler', 'project');
  const adoption = await verifyAdoption({
    stored: prior,
    lookup,
    create: () => createOrAdopt(
      `Doppler project ${project}`,
      async () => providerJson<unknown>(await providerFetch('https://api.doppler.com/v3/projects', {
        method: 'POST',
        headers: dopplerHeaders(),
        body: JSON.stringify(dopplerProjectRequest(project)),
      }), 'Doppler project provisioning'),
      lookup,
      { onEvent: logFactory },
    ),
    verify: (value, stored) => verifiedDopplerResource(value, { project }, stored),
  });
  await saveResource(run.id, adoption.resource);
  await verifyCredential(run.id, 'doppler.service_token');
  return adoption.resource;
}

export async function writeDopplerSecrets(
  project: string,
  secrets: Record<string, string>,
): Promise<void> {
  const config = process.env.DOPPLER_PRODUCTION_CONFIG?.trim() || 'prd';
  const response = await providerFetch('https://api.doppler.com/v3/configs/config/secrets', {
    method: 'POST', headers: dopplerHeaders(), body: JSON.stringify({ project, config, secrets }),
  }, true);
  if (!response.ok) throw new Error(`Doppler secret synchronization failed (${response.status}).`);
}

export async function readDopplerSecrets(project: string): Promise<Record<string, string>> {
  const config = process.env.DOPPLER_PRODUCTION_CONFIG?.trim() || 'prd';
  const query = new URLSearchParams({ project, config, format: 'json' });
  const response = await providerFetch(
    `https://api.doppler.com/v3/configs/config/secrets/download?${query}`,
    { headers: dopplerHeaders() },
  );
  return providerJson<Record<string, string>>(response, 'Doppler runtime configuration lookup');
}

async function findSupabaseProject(name: string): Promise<unknown | null> {
  const organization = encodeURIComponent(requiredEnvironment('SUPABASE_ORGANIZATION_SLUG'));
  const token = requiredEnvironment('SUPABASE_MANAGEMENT_TOKEN');
  const query = new URLSearchParams({ limit: '100', search: name });
  const response = await providerFetch(
    `https://api.supabase.com/v1/organizations/${organization}/projects?${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const payload = await providerJson<unknown>(
    response,
    'Supabase project lookup',
  );
  return supabaseProjectFromLookup(payload, name);
}

export async function provisionSupabase(run: FactoryRunRow): Promise<SafeResource> {
  'use step';
  const prior = await existingResource(run.id, 'supabase', 'project');
  const organizationSlug = requiredEnvironment('SUPABASE_ORGANIZATION_SLUG');
  const expected = {
    project: run.tenantSlug, region: run.supabaseRegion, organizationSlug,
  };
  const found = await findSupabaseProject(run.tenantSlug);
  const adoption = verifyExistingAdoption(prior, found, (value, stored) => (
    verifiedSupabaseResource(value, expected, stored)
  ));
  let resource: SafeResource;
  if (adoption) {
    const stored = await readDopplerSecrets(run.tenantSlug);
    if (!stored.SUPABASE_DB_PASSWORD) {
      throw new Error('Existing Supabase project is missing its managed database-password reference.');
    }
    resource = adoption.resource;
  } else {
    const password = `${randomBytes(32).toString('base64url')}Aa1!`;
    await writeDopplerSecrets(run.tenantSlug, { SUPABASE_DB_PASSWORD: password });
    const token = requiredEnvironment('SUPABASE_MANAGEMENT_TOKEN');
    const body = supabaseProjectRequest(
      run.tenantSlug,
      organizationSlug,
      run.supabaseRegion,
      password,
    );
    const created = await createOrAdopt(
      `Supabase project ${run.tenantSlug}`,
      async () => providerJson<unknown>(
        await providerFetch('https://api.supabase.com/v1/projects', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        'Supabase project provisioning',
      ),
      () => findSupabaseProject(run.tenantSlug),
      { onEvent: logFactory },
    );
    resource = verifiedSupabaseResource(created, expected, null);
  }
  await saveResource(run.id, resource);
  await verifyCredential(run.id, 'supabase.management_token');
  return resource;
}

export async function synchronizeSupabaseRuntime(
  run: FactoryRunRow,
  reference: string,
): Promise<boolean> {
  'use step';
  const token = requiredEnvironment('SUPABASE_MANAGEMENT_TOKEN');
  const response = await providerFetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(reference)}/api-keys`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if ([404, 409, 423].includes(response.status)) return false;
  const keys = await providerJson<{ name?: string; api_key?: string }[]>(
    response,
    'Supabase runtime credential lookup',
  );
  const publishable = keys.find((key) => key.name === 'publishable')?.api_key
    ?? keys.find((key) => key.name === 'anon')?.api_key;
  const serviceRole = keys.find((key) => key.name === 'secret')?.api_key
    ?? keys.find((key) => key.name === 'service_role')?.api_key;
  if (!publishable || !serviceRole) return false;
  await writeDopplerSecrets(run.tenantSlug, {
    SUPABASE_URL: `https://${reference}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: publishable,
    SUPABASE_SERVICE_ROLE_KEY: serviceRole,
  });
  return true;
}
