import {
  factoryCompletionMintsHosts,
  mayPromoteLive,
} from '@platform/factory';

import { advanceFactoryRelease } from './factory-release';
import {
  completedFactoryTasks,
  factoryReleaseDependencies,
  loadContentEvidence,
  organizationBrandId,
} from './factory-release-runtime';
import { synchronizeDeploymentEvidence } from './factory-deployment-sync';
import { synchronizeGitHubArtifactDigest } from './factory-github-actions';
import { synchronizePublishedContent } from './factory-content';
import {
  createDemo,
  mintProductionHosts,
  provisionSandboxInfrastructure,
} from './factory-pipeline-tasks';
import {
  blockForCredentials,
  failRun,
  type PlatformFactoryResult,
} from './factory-run-state';
import {
  loadRun,
  logFactory,
  requiredCredentialKeys,
  synchronizeCredentials,
  updateRun,
  updateTask,
} from './factory-runtime';

type PlatformFactoryInput = {
  runId: string;
  /** Owner/admin tapped Go live. Never set by automatic factory resume. */
  goLiveApproved?: boolean;
};

export async function runPlatformFactory(input: PlatformFactoryInput): Promise<PlatformFactoryResult> {
  'use workflow';
  const goLiveApproved = input.goLiveApproved === true;
  try {
    const run = await loadRun(input.runId);
    const completed = new Set(await completedFactoryTasks(run.id));
    if (completed.has('promote-live')) {
      // Completed runs still must not mint hosts unless Go live was approved.
      if (factoryCompletionMintsHosts(true, goLiveApproved) === false) {
        logFactory('go_live.guard', {
          runId: run.id,
          message: 'completed factory run does not mint hosts without Go live',
        });
      }
      return { status: 'live', missingCredentialKeys: [] };
    }
    const available = await synchronizeCredentials(run.id);
    if (!completed.has('verify-demo')) {
      if (!available.includes('openai.api_key')) {
        return blockForCredentials(run, 'research-brand', 'research_setup_required', ['openai.api_key']);
      }
      await createDemo(run);
      completed.add('verify-demo');
    }
    if (!completed.has('collect-credentials')) {
      const required = await requiredCredentialKeys(run.id);
      const missing = required.filter((key) => !available.includes(key));
      if (missing.length > 0) {
        return blockForCredentials(run, 'collect-credentials', 'provider_access_required', missing);
      }
      await updateTask(run.id, 'collect-credentials', 'completed');
      completed.add('collect-credentials');
    }
    if (!completed.has('create-supabase-project')) {
      await updateRun(run.id, { state: 'running', stage: 'infrastructure', last_error_code: null });
      await provisionSandboxInfrastructure(run);
      completed.add('create-supabase-project');
    }

    // Automatic path never mints production hosts.
    if (!goLiveApproved && !completed.has('create-vercel-projects')) {
      logFactory('go_live.deferred', {
        runId: run.id,
        tenantSlug: run.tenantSlug,
        message: 'create-vercel-projects deferred until owner/admin Go live',
      });
    }

    await synchronizePublishedContent(run.id, run.tenantSlug);
    const brandId = await organizationBrandId(run.tenantSlug);
    const content = brandId ? await loadContentEvidence(run.id, brandId) : null;
    if (content) {
      await synchronizeGitHubArtifactDigest(run, content.artifactDigest);
      await synchronizeDeploymentEvidence(run, content.artifactDigest);
    }

    if (goLiveApproved) {
      if (!mayPromoteLive(true)) {
        throw new Error('Go live promotion refused.');
      }
      if (!completed.has('verify-canary')) {
        // Still need canary before minting hosts.
        const release = await advanceFactoryRelease(
          run,
          completed,
          { ...factoryReleaseDependencies(run), goLiveApproved: false },
        );
        if (release.status !== 'blocked' || release.code !== 'go_live_required') {
          return {
            status: release.status,
            missingCredentialKeys: [],
            code: release.code,
          };
        }
        completed.add('verify-canary');
      }
      if (!completed.has('create-vercel-projects')) {
        await mintProductionHosts(run);
        completed.add('create-vercel-projects');
      }
      const live = await advanceFactoryRelease(
        run,
        completed,
        { ...factoryReleaseDependencies(run), goLiveApproved: true },
      );
      return { status: live.status, missingCredentialKeys: [], code: live.code };
    }

    const release = await advanceFactoryRelease(
      run,
      completed,
      { ...factoryReleaseDependencies(run), goLiveApproved: false },
    );
    return { status: release.status, missingCredentialKeys: [], code: release.code };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Platform factory failed.';
    await failRun(input.runId, message);
    throw error;
  }
}
