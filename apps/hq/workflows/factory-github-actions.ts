import { encryptGitHubActionsSecret } from '../lib/github-actions-secrets';
import { githubHeaders, githubInstallationToken } from './factory-github';
import { readDopplerSecrets } from './factory-secrets';
import {
  existingResource,
  providerFetch,
  providerJson,
  requiredEnvironment,
  saveResource,
  type FactoryRunRow,
} from './factory-runtime';

const ARTIFACT_DIGEST = /^sha256:[0-9a-f]{64}$/;

export function githubArtifactDigest(value: string): string {
  const digest = value.trim();
  if (!ARTIFACT_DIGEST.test(digest)) {
    throw new Error('Factory deployment artifact digest is invalid.');
  }
  return digest;
}

async function putSecret(
  repository: string,
  token: string,
  publicKey: { key: string; key_id: string },
  name: string,
  value: string,
): Promise<void> {
  const encryptedValue = await encryptGitHubActionsSecret(value, publicKey.key);
  const response = await providerFetch(
    `https://api.github.com/repos/${repository}/actions/secrets/${encodeURIComponent(name)}`,
    {
      method: 'PUT', headers: githubHeaders(token),
      body: JSON.stringify({ encrypted_value: encryptedValue, key_id: publicKey.key_id }),
    },
  );
  if (!response.ok) throw new Error(`GitHub deployment secret synchronization failed for ${name}.`);
}

async function putVariable(
  repository: string,
  token: string,
  name: string,
  value: string,
): Promise<void> {
  const endpoint = `https://api.github.com/repos/${repository}/actions/variables`;
  let response = await providerFetch(endpoint, {
    method: 'POST', headers: githubHeaders(token), body: JSON.stringify({ name, value }),
  }, true);
  if (response.status === 409) {
    response = await providerFetch(`${endpoint}/${encodeURIComponent(name)}`, {
      method: 'PATCH', headers: githubHeaders(token), body: JSON.stringify({ name, value }),
    });
  }
  if (!response.ok) throw new Error(`GitHub deployment variable synchronization failed for ${name}.`);
}

export async function synchronizeGitHubDeployment(
  run: FactoryRunRow,
  repository: string,
): Promise<void> {
  'use step';
  const token = await githubInstallationToken();
  const keyResponse = await providerFetch(
    `https://api.github.com/repos/${repository}/actions/secrets/public-key`,
    { headers: githubHeaders(token) },
  );
  const key = await providerJson<{ key?: string; key_id?: string }>(
    keyResponse,
    'GitHub Actions public-key lookup',
  );
  if (!key.key || !key.key_id) throw new Error('GitHub Actions returned no repository encryption key.');
  const stored = await readDopplerSecrets(run.tenantSlug);
  const secrets: Record<string, string | undefined> = {
    SUPABASE_ACCESS_TOKEN: requiredEnvironment('SUPABASE_MANAGEMENT_TOKEN'),
    SUPABASE_URL: stored.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: stored.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: stored.SUPABASE_SERVICE_ROLE_KEY,
    VERCEL_TOKEN: requiredEnvironment('VERCEL_TOKEN'),
    CRON_SECRET: stored.CRON_SECRET,
    HEALTH_CHECK_TOKEN: stored.HEALTH_CHECK_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (!value && name !== 'OPENAI_API_KEY') {
      throw new Error(`Deployment credential ${name} is unavailable.`);
    }
    if (value) await putSecret(repository, token, key as { key: string; key_id: string }, name, value);
  }
  const variables = {
    VERCEL_SCOPE: requiredEnvironment('VERCEL_SCOPE'),
    TENANT_SURFACES: run.surfaces.join(','),
    OPENAI_RESEARCH_MODEL: process.env.OPENAI_RESEARCH_MODEL ?? '',
    OPENAI_EVALUATION_MODEL: process.env.OPENAI_EVALUATION_MODEL ?? '',
  };
  for (const [name, value] of Object.entries(variables)) {
    if (value) await putVariable(repository, token, name, value);
  }
  await saveResource(run.id, {
    provider: 'github', kind: 'deployment-configuration', externalId: repository,
    displayName: `${repository} deployment configuration`,
    metadata: {
      secretNames: Object.entries(secrets).filter(([, value]) => value).map(([name]) => name),
      variableNames: Object.entries(variables).filter(([, value]) => value).map(([name]) => name),
    },
  });
}

/** Publishes the release digest only after the factory has authoritative content evidence. */
export async function synchronizeGitHubArtifactDigest(
  run: FactoryRunRow,
  artifactDigest: string,
): Promise<void> {
  'use step';
  const digest = githubArtifactDigest(artifactDigest);
  const repository = await existingResource(run.id, 'github', 'repository');
  if (!repository) throw new Error('Factory release repository is unavailable.');
  const token = await githubInstallationToken();
  await putVariable(repository.externalId, token, 'FACTORY_ARTIFACT_DIGEST', digest);
  await saveResource(run.id, {
    provider: 'github', kind: 'release-attestation', externalId: repository.externalId,
    displayName: `${repository.externalId} release attestation`,
    metadata: { variableName: 'FACTORY_ARTIFACT_DIGEST', artifactDigest: digest },
  });
}
