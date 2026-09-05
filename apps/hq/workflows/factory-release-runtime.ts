import { createHash } from 'node:crypto';

import type { FactoryReleaseDependencies, ContentEvidence, DeploymentEvidence } from './factory-release';
import { database, updateRun, updateTask, type FactoryRunRow } from './factory-runtime';

type ArtifactRow = {
  id: string;
  artifact_kind: string;
  source_fingerprint: string;
};

const FINGERPRINT = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reference(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500
    ? value.trim()
    : null;
}

export function deploymentEvidence(
  value: unknown,
  tenantSlug: string,
  artifactDigest: string,
): DeploymentEvidence | null {
  const manifest = record(value);
  const canary = record(manifest?.canary);
  const promotion = record(manifest?.promotion);
  const commitSha = manifest?.commitSha;
  const digest = manifest?.artifactDigest;
  const canaryStatus = canary?.status;
  const canaryReference = reference(canary?.providerReference);
  const promotionReference = reference(promotion?.providerReference);
  if (manifest?.tenantSlug !== tenantSlug || digest !== artifactDigest || !DIGEST.test(String(digest))
    || typeof commitSha !== 'string' || !COMMIT.test(commitSha)
    || (canaryStatus !== 'passed' && canaryStatus !== 'failed') || !canaryReference) {
    return null;
  }
  return {
    artifactDigest: digest,
    commitSha,
    canaryStatus,
    canaryReference,
    ...(promotion?.status === 'promoted' && promotionReference ? { promotionReference } : {}),
  };
}

export async function completedFactoryTasks(runId: string): Promise<ReadonlySet<string>> {
  'use step';
  const result = await database().from('platform_onboarding_tasks')
    .select('task_key').eq('run_id', runId).eq('state', 'completed');
  if (result.error) throw new Error(`Factory task checkpoint failed: ${result.error.code}`);
  return new Set((result.data ?? []).map((row) => row.task_key));
}

export async function loadContentEvidence(runId: string): Promise<ContentEvidence | null> {
  'use step';
  const result = await database().from('platform_artifact_manifests')
    .select('id,artifact_kind,source_fingerprint,version')
    .eq('run_id', runId).eq('validation_state', 'valid')
    .in('artifact_kind', ['application', 'catalog', 'training'])
    .order('version', { ascending: false });
  if (result.error) throw new Error(`Factory content lookup failed: ${result.error.code}`);
  const latest = new Map<string, ArtifactRow>();
  for (const row of result.data ?? []) {
    if (!latest.has(row.artifact_kind) && FINGERPRINT.test(row.source_fingerprint)) {
      latest.set(row.artifact_kind, row);
    }
  }
  const artifacts = ['application', 'catalog', 'training'].map((kind) => latest.get(kind));
  if (artifacts.some((artifact) => !artifact)) return null;
  const complete = artifacts as ArtifactRow[];
  const digest = createHash('sha256');
  for (const artifact of complete) {
    digest.update(`${artifact.artifact_kind}:${artifact.source_fingerprint}\n`);
  }
  return {
    artifactDigest: `sha256:${digest.digest('hex')}`,
    artifactIds: complete.map((artifact) => artifact.id),
  };
}

async function publishContent(evidence: ContentEvidence): Promise<void> {
  'use step';
  const result = await database().from('platform_artifact_manifests')
    .update({ published_at: new Date().toISOString() })
    .in('id', [...evidence.artifactIds]).eq('validation_state', 'valid')
    .select('id');
  if (result.error || result.data?.length !== evidence.artifactIds.length) {
    throw new Error(`Factory content publication failed: ${result.error?.code ?? 'artifact_changed'}`);
  }
}

async function organizationBrandId(tenantSlug: string): Promise<string | null> {
  'use step';
  const brand = await database().from('brands').select('id')
    .eq('slug', tenantSlug).in('status', ['provisioning', 'active']).maybeSingle();
  if (brand.error) throw new Error(`Factory organization lookup failed: ${brand.error.code}`);
  if (!brand.data) return null;
  const run = await database().from('organization_provisioning_runs').select('brand_id')
    .eq('brand_id', brand.data.id).maybeSingle();
  if (run.error) throw new Error(`Factory readiness bridge failed: ${run.error.code}`);
  return run.data ? brand.data.id : null;
}

async function recordReadiness(
  brandId: string,
  check: 'tenant_artifacts' | 'release_approval',
  evidence: Record<string, string>,
): Promise<void> {
  'use step';
  const result = await database().rpc('record_organization_readiness', {
    p_brand_id: brandId, p_check_key: check, p_passed: true, p_evidence: evidence,
  });
  if (result.error) throw new Error(`Factory readiness recording failed: ${result.error.code}`);
}

async function loadDeploymentEvidence(
  runId: string,
  tenantSlug: string,
  artifactDigest: string,
): Promise<DeploymentEvidence | null> {
  'use step';
  const result = await database().from('platform_artifact_manifests').select('manifest')
    .eq('run_id', runId).eq('artifact_kind', 'deployment').eq('validation_state', 'valid')
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (result.error) throw new Error(`Factory deployment evidence lookup failed: ${result.error.code}`);
  return deploymentEvidence(result.data?.manifest, tenantSlug, artifactDigest);
}

export function factoryReleaseDependencies(run: FactoryRunRow): FactoryReleaseDependencies {
  return {
    loadContentEvidence,
    publishContent,
    organizationBrandId,
    recordReadiness,
    loadDeploymentEvidence,
    updateTask: (task, state, code = null) => updateTask(run.id, task, state, code),
    updateRun: (values) => updateRun(run.id, values),
  };
}
