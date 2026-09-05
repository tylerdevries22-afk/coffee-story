import type { FactoryRunRow } from './factory-runtime';

export type ContentEvidence = {
  artifactDigest: string;
  artifactIds: readonly string[];
};

export type DeploymentEvidence = {
  artifactDigest: string;
  commitSha: string;
  canaryStatus: 'passed' | 'failed';
  canaryReference: string;
  promotionReference?: string;
};

export type FactoryReleaseResult = {
  status: 'blocked' | 'failed' | 'live';
  stage: 'content' | 'canary' | 'live';
  code?: string;
};

export type FactoryReleaseDependencies = {
  loadContentEvidence: (runId: string) => Promise<ContentEvidence | null>;
  publishContent: (evidence: ContentEvidence) => Promise<void>;
  organizationBrandId: (tenantSlug: string) => Promise<string | null>;
  recordReadiness: (
    brandId: string,
    check: 'tenant_artifacts' | 'release_approval',
    evidence: Record<string, string>,
  ) => Promise<void>;
  loadDeploymentEvidence: (
    runId: string,
    tenantSlug: string,
    artifactDigest: string,
  ) => Promise<DeploymentEvidence | null>;
  updateTask: (task: string, state: string, code?: string | null) => Promise<void>;
  updateRun: (values: Record<string, unknown>) => Promise<void>;
};

async function block(
  dependencies: FactoryReleaseDependencies,
  task: string,
  stage: 'content' | 'canary',
  code: string,
): Promise<FactoryReleaseResult> {
  await dependencies.updateTask(task, 'blocked', code);
  await dependencies.updateRun({ state: 'blocked', stage, last_error_code: code });
  return { status: 'blocked', stage, code };
}

export async function advanceFactoryRelease(
  run: FactoryRunRow,
  completedTasks: ReadonlySet<string>,
  dependencies: FactoryReleaseDependencies,
): Promise<FactoryReleaseResult> {
  if (completedTasks.has('promote-live')) return { status: 'live', stage: 'live' };

  const content = await dependencies.loadContentEvidence(run.id);
  if (!content) {
    return block(dependencies, 'publish-content', 'content', 'content_bootstrap_required');
  }
  const brandId = await dependencies.organizationBrandId(run.tenantSlug);
  if (!brandId) {
    return block(
      dependencies,
      'publish-content',
      'content',
      'organization_readiness_bridge_required',
    );
  }
  const firstPublication = !completedTasks.has('publish-content');
  if (firstPublication) {
    await dependencies.updateRun({ state: 'running', stage: 'content', last_error_code: null });
    await dependencies.updateTask('publish-content', 'running');
  }
  await dependencies.publishContent(content);
  await dependencies.recordReadiness(brandId, 'tenant_artifacts', {
    artifactDigest: content.artifactDigest,
  });
  if (firstPublication) {
    await dependencies.updateTask('publish-content', 'completed');
  }

  const deployment = await dependencies.loadDeploymentEvidence(
    run.id,
    run.tenantSlug,
    content.artifactDigest,
  );
  if (!deployment) {
    return block(dependencies, 'verify-canary', 'canary', 'canary_evidence_required');
  }
  if (!completedTasks.has('verify-canary')) {
    await dependencies.updateRun({ state: 'running', stage: 'canary', last_error_code: null });
    await dependencies.updateTask('verify-canary', 'running');
    if (deployment.canaryStatus === 'failed') {
      await dependencies.updateTask('verify-canary', 'failed', 'canary_verification_failed');
      await dependencies.updateRun({
        state: 'failed', stage: 'canary', last_error_code: 'canary_verification_failed',
      });
      return { status: 'failed', stage: 'canary', code: 'canary_verification_failed' };
    }
    await dependencies.updateTask('verify-canary', 'completed');
  }

  if (!deployment.promotionReference) {
    return block(dependencies, 'promote-live', 'canary', 'promotion_evidence_required');
  }
  await dependencies.updateTask('promote-live', 'running');
  await dependencies.recordReadiness(brandId, 'release_approval', {
    commitSha: deployment.commitSha,
    artifactDigest: deployment.artifactDigest,
    providerReference: deployment.promotionReference,
  });
  await dependencies.updateTask('promote-live', 'completed');
  await dependencies.updateRun({ state: 'live', stage: 'live', last_error_code: null });
  return { status: 'live', stage: 'live' };
}
