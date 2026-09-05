import { createSign } from 'node:crypto';

import { githubTemplateRequest } from '@platform/factory';

import { createOrAdopt } from '../lib/provider-create';
import { verifiedGitHubResource, verifyAdoption } from './factory-provider-adoption';
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

export function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2026-03-10',
  };
}

export async function githubInstallationToken(): Promise<string> {
  'use step';
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: requiredEnvironment('GITHUB_APP_ID'),
  })).toString('base64url');
  const input = `${header}.${claims}`;
  const privateKey = requiredEnvironment('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
  const signature = createSign('RSA-SHA256').update(input).sign(privateKey, 'base64url');
  const appJwt = `${input}.${signature}`;
  const installationId = encodeURIComponent(requiredEnvironment('GITHUB_APP_INSTALLATION_ID'));
  const response = await providerFetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: githubHeaders(appJwt),
      body: JSON.stringify({
        permissions: {
          actions: 'write', administration: 'write', contents: 'read',
          metadata: 'read', secrets: 'write', variables: 'write',
        },
      }),
    },
  );
  const payload = await providerJson<{ token?: string }>(response, 'GitHub installation authentication');
  if (!payload.token) throw new Error('GitHub installation authentication returned no token.');
  return payload.token;
}

export async function provisionGitHub(run: FactoryRunRow): Promise<SafeResource> {
  'use step';
  const owner = requiredEnvironment('GITHUB_REPOSITORY_OWNER');
  const templateOwner = requiredEnvironment('GITHUB_TEMPLATE_OWNER');
  const templateName = requiredEnvironment('GITHUB_TEMPLATE_REPOSITORY');
  const repository = `${owner}/${run.tenantSlug}`;
  const templateRepository = `${templateOwner}/${templateName}`;
  const token = await githubInstallationToken();
  const lookup = async (): Promise<unknown | null> => {
    const found = await providerFetch(
      `https://api.github.com/repos/${repository}`,
      { headers: githubHeaders(token) },
    );
    return found.status === 404 ? null : providerJson<unknown>(found, 'GitHub repository lookup');
  };
  const prior = await existingResource(run.id, 'github', 'repository');
  const adoption = await verifyAdoption({
    stored: prior,
    lookup,
    create: () => createOrAdopt(
      `GitHub repository ${repository}`,
      async () => providerJson<unknown>(await providerFetch(
        `https://api.github.com/repos/${encodeURIComponent(templateOwner)}/${encodeURIComponent(templateName)}/generate`, {
          method: 'POST',
          headers: githubHeaders(token),
          body: JSON.stringify(githubTemplateRequest(run.tenantSlug, owner)),
        }), 'GitHub repository provisioning'),
      lookup,
      { onEvent: logFactory },
    ),
    verify: (value, stored) => verifiedGitHubResource(value, {
      repository, owner, templateRepository,
    }, stored),
  });
  if (adoption.persist) await saveResource(run.id, adoption.resource);
  await verifyCredential(run.id, 'github.app');
  return adoption.resource;
}

export async function currentGitHubCommit(repository: string): Promise<string> {
  const token = await githubInstallationToken();
  const response = await providerFetch(
    `https://api.github.com/repos/${repository}/commits?per_page=1`,
    { headers: githubHeaders(token) },
  );
  const payload = await providerJson<{ sha?: unknown }[]>(response, 'GitHub release commit lookup');
  const sha = payload[0]?.sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('GitHub release commit lookup returned no immutable commit.');
  }
  return sha;
}
