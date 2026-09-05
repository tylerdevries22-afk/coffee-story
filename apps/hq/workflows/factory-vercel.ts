import { randomBytes } from 'node:crypto';

import { vercelProjectSpecifications, type FactorySurface } from '@platform/factory';

import { createOrAdopt } from '../lib/provider-create';
import { verifiedVercelResource, verifyExistingAdoption } from './factory-provider-adoption';
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
import { readDopplerSecrets, writeDopplerSecrets } from './factory-secrets';
import {
  synchronizeVercelEnvironment,
  vercelRuntimeVariables,
  type VercelRuntimeVariable,
} from './factory-vercel-environment';

function vercelScopeQuery(scope: string): string {
  return new URLSearchParams(scope.startsWith('team_') ? { teamId: scope } : { slug: scope }).toString();
}

function vercelHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requiredEnvironment('VERCEL_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

async function createVercelProject(
  specification: ReturnType<typeof vercelProjectSpecifications>[number],
  variables: readonly VercelRuntimeVariable[],
  scope: string,
  lookup: () => Promise<unknown | null>,
): Promise<unknown> {
  const query = vercelScopeQuery(scope);
  return createOrAdopt(
    `Vercel project ${specification.name}`,
    async () => providerJson<unknown>(await providerFetch(
      `https://api.vercel.com/v11/projects?${query}`, {
        method: 'POST', headers: vercelHeaders(), body: JSON.stringify({
          name: specification.name,
          rootDirectory: specification.rootDirectory,
          gitRepository: { type: 'github', repo: specification.repository },
          environmentVariables: variables,
          ...(specification.framework ? { framework: specification.framework } : {}),
        }),
      },
    ), `Vercel project provisioning for ${specification.name}`),
    lookup,
    { onEvent: logFactory },
  );
}

async function findVercelProject(
  specification: ReturnType<typeof vercelProjectSpecifications>[number],
  scope: string,
): Promise<unknown | null> {
  const query = vercelScopeQuery(scope);
  const found = await providerFetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(specification.name)}?${query}`,
    { headers: vercelHeaders() },
  );
  return found.status === 404
    ? null
    : providerJson<unknown>(found, `Vercel project lookup for ${specification.name}`);
}

export async function provisionVercel(
  run: FactoryRunRow,
  repository: string,
): Promise<readonly SafeResource[]> {
  'use step';
  const scope = requiredEnvironment('VERCEL_SCOPE');
  const specifications = vercelProjectSpecifications(run.tenantSlug, repository, run.surfaces);
  const plans = [] as Array<{
    specification: (typeof specifications)[number];
    surface: FactorySurface;
    kind: string;
    prior: SafeResource | null;
    lookup: () => Promise<unknown | null>;
    resource: SafeResource | null;
  }>;
  for (const specification of specifications) {
    const surface = run.surfaces.find((candidate) => (
      specification.name === `${run.tenantSlug}-${candidate}`
    ));
    if (!surface) throw new Error('Vercel project does not match a requested tenant surface.');
    const kind = `project-${surface}`;
    const prior = await existingResource(run.id, 'vercel', kind);
    const lookup = () => findVercelProject(specification, scope);
    const found = await lookup();
    const adoption = verifyExistingAdoption(prior, found, (value, stored) => (
      verifiedVercelResource(value, {
      kind, name: specification.name, repository: specification.repository,
      rootDirectory: specification.rootDirectory, scope,
      }, stored)
    ));
    plans.push({ specification, surface, kind, prior, lookup, resource: adoption?.resource ?? null });
  }
  const secrets = await readDopplerSecrets(run.tenantSlug);
  if (!secrets.SUPABASE_URL || !secrets.SUPABASE_PUBLISHABLE_KEY
    || !secrets.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase runtime configuration is not ready for deployment.');
  }
  if (!secrets.CRON_SECRET) {
    secrets.CRON_SECRET = randomBytes(32).toString('base64url');
    await writeDopplerSecrets(run.tenantSlug, { CRON_SECRET: secrets.CRON_SECRET });
  }
  if (!secrets.HEALTH_CHECK_TOKEN) {
    secrets.HEALTH_CHECK_TOKEN = randomBytes(32).toString('base64url');
    await writeDopplerSecrets(run.tenantSlug, { HEALTH_CHECK_TOKEN: secrets.HEALTH_CHECK_TOKEN });
  }
  const resources: SafeResource[] = [];
  for (const plan of plans) {
    const variables = vercelRuntimeVariables(plan.surface, run.tenantSlug, secrets);
    const payload = plan.resource ? null : await createVercelProject(
      plan.specification,
      variables,
      scope,
      plan.lookup,
    );
    const resource = plan.resource ?? verifiedVercelResource(payload, {
      kind: plan.kind, name: plan.specification.name,
      repository: plan.specification.repository,
      rootDirectory: plan.specification.rootDirectory, scope,
    }, null);
    await synchronizeVercelEnvironment(resource.externalId, vercelScopeQuery(scope), variables, {
      headers: vercelHeaders(),
    });
    if (!plan.prior) await saveResource(run.id, resource);
    resources.push(resource);
  }
  await verifyCredential(run.id, 'vercel.token');
  return resources;
}
