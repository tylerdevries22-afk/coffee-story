import type { FactorySurface } from '@platform/factory';

import {
  database,
  existingResource,
  providerFetch,
  providerJson,
  requiredEnvironment,
  saveArtifact,
  type FactoryRunRow,
} from './factory-runtime';
import { readDopplerSecrets } from './factory-secrets';
import { currentGitHubCommit } from './factory-github';

type DeploymentRow = {
  uid?: unknown;
  url?: unknown;
  state?: unknown;
  readySubstate?: unknown;
  target?: unknown;
  meta?: unknown;
};

type VerifiedDeployment = {
  uid: string;
  url: string;
  commitSha: string;
  artifactDigest: string;
};

type ExistingArtifact = { version: number; manifest: unknown };

const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const VERCEL_HOST = /^[a-z0-9-]+\.vercel\.app$/;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function verifiedDeployment(value: unknown): VerifiedDeployment | null {
  const row = object(value) as DeploymentRow | null;
  const meta = object(row?.meta);
  const uid = typeof row?.uid === 'string' ? row.uid.trim() : '';
  const host = typeof row?.url === 'string' ? row.url.trim().replace(/^https:\/\//, '') : '';
  const commitSha = typeof meta?.githubCommitSha === 'string' ? meta.githubCommitSha : '';
  const artifactDigest = typeof meta?.factoryArtifactDigest === 'string'
    ? meta.factoryArtifactDigest : '';
  if (!uid || !VERCEL_HOST.test(host) || row?.state !== 'READY'
    || row?.readySubstate !== 'PROMOTED' || row?.target !== 'production'
    || !COMMIT.test(commitSha) || !DIGEST.test(artifactDigest)) return null;
  return { uid, url: `https://${host}`, commitSha, artifactDigest };
}

export function tenantMarkerMatches(html: string, tenantSlug: string): boolean {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].some(([tag]) => {
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    return name === 'platform-tenant' && content === tenantSlug;
  });
}

export async function canaryResponseMatches(
  response: Response,
  surface: FactorySurface,
  tenantSlug: string,
  commitSha: string,
): Promise<boolean> {
  if (!response.ok) return false;
  try {
    if (surface !== 'hq') {
      return response.headers.get('content-type')?.includes('text/html') === true
        && tenantMarkerMatches(await response.text(), tenantSlug);
    }
    const payload = await response.json() as { ok?: unknown; version?: unknown; tenant?: unknown };
    return payload.ok === true && payload.tenant === tenantSlug
      && typeof payload.version === 'string' && commitSha.startsWith(payload.version);
  } catch {
    return false;
  }
}

function scopeQuery(): string {
  const scope = requiredEnvironment('VERCEL_SCOPE');
  return new URLSearchParams(scope.startsWith('team_') ? { teamId: scope } : { slug: scope })
    .toString();
}

async function latestDeployment(run: FactoryRunRow, surface: FactorySurface): Promise<VerifiedDeployment | null> {
  const resource = await existingResource(run.id, 'vercel', `project-${surface}`);
  if (!resource) return null;
  const query = new URLSearchParams({
    projectId: resource.externalId, target: 'production', state: 'READY', limit: '1',
  });
  const response = await providerFetch(
    `https://api.vercel.com/v7/deployments?${query}&${scopeQuery()}`,
    { headers: { Authorization: `Bearer ${requiredEnvironment('VERCEL_TOKEN')}` } },
  );
  const payload = await providerJson<{ deployments?: unknown[] }>(
    response,
    `Vercel deployment lookup for ${surface}`,
  );
  return verifiedDeployment(payload.deployments?.[0]);
}

async function canary(
  deployment: VerifiedDeployment,
  surface: FactorySurface,
  tenantSlug: string,
  healthToken: string,
): Promise<boolean> {
  const path = surface === 'hq' ? '/api/health?deep=1' : '/';
  const response = await providerFetch(`${deployment.url}${path}`, {
    headers: surface === 'hq' ? { 'x-health-check-token': healthToken } : {},
  });
  return canaryResponseMatches(response, surface, tenantSlug, deployment.commitSha);
}

async function deploymentArtifactVersion(
  runId: string,
  artifactDigest: string,
  commitSha: string,
): Promise<number | null> {
  const result = await database().from('platform_artifact_manifests')
    .select('version,manifest').eq('run_id', runId).eq('artifact_kind', 'deployment')
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(`Factory deployment artifact lookup failed: ${result.error.code}`);
  const existing = result.data as ExistingArtifact | null;
  const manifest = object(existing?.manifest);
  if (manifest?.artifactDigest === artifactDigest && manifest.commitSha === commitSha) return null;
  return (existing?.version ?? 0) + 1;
}

/** Records evidence only after every requested production surface serves one commit. */
export async function synchronizeDeploymentEvidence(
  run: FactoryRunRow,
  artifactDigest: string,
): Promise<boolean> {
  'use step';
  const deployments = await Promise.all(run.surfaces.map(async (surface) => ({
    surface,
    deployment: await latestDeployment(run, surface),
  })));
  if (deployments.some(({ deployment }) => !deployment)) return false;
  const verified = deployments as { surface: FactorySurface; deployment: VerifiedDeployment }[];
  const commits = new Set(verified.map(({ deployment }) => deployment.commitSha));
  const digests = new Set(verified.map(({ deployment }) => deployment.artifactDigest));
  if (commits.size !== 1 || digests.size !== 1 || !digests.has(artifactDigest)) return false;
  const repository = await existingResource(run.id, 'github', 'repository');
  if (!repository) return false;
  const releaseCommit = await currentGitHubCommit(repository.externalId);
  if (!commits.has(releaseCommit)) return false;
  const secrets = await readDopplerSecrets(run.tenantSlug);
  const healthToken = secrets.HEALTH_CHECK_TOKEN;
  const first = verified[0];
  if (!healthToken || !first) return false;
  const results = await Promise.all(verified.map(({ deployment, surface }) => (
    canary(deployment, surface, run.tenantSlug, healthToken)
  )));
  if (results.some((passed) => !passed)) return false;
  const commitSha = first.deployment.commitSha;
  const references = verified.map(({ surface, deployment }) => `${surface}:${deployment.uid}`);
  const version = await deploymentArtifactVersion(run.id, artifactDigest, commitSha);
  if (version === null) return true;
  await saveArtifact(run.id, 'deployment', {
    tenantSlug: run.tenantSlug,
    artifactDigest,
    commitSha,
    canary: { status: 'passed', providerReference: `vercel:${references.join(',')}` },
    promotion: { status: 'promoted', providerReference: `vercel:production:${commitSha}` },
  }, version);
  return true;
}
