import { sleep } from 'workflow';

import {
  factoryCompletionMintsHosts,
  mayMintProductionHosts,
  mayPromoteLive,
} from '@platform/factory';

import { buildFactoryApplicationManifest } from '../lib/factory-automation';
import { advanceFactoryRelease } from './factory-release';
import {
  completedFactoryTasks,
  factoryReleaseDependencies,
  loadContentEvidence,
  organizationBrandId,
} from './factory-release-runtime';
import { synchronizeDeploymentEvidence } from './factory-deployment-sync';
import {
  synchronizeGitHubArtifactDigest,
  synchronizeGitHubDeployment,
} from './factory-github-actions';
import { provisionGitHub } from './factory-github';
import { synchronizePublishedContent } from './factory-content';
import { researchBrand } from './factory-research';
import {
  database,
  existingResource,
  loadRun,
  logFactory,
  requiredCredentialKeys,
  saveArtifact,
  synchronizeCredentials,
  updateRun,
  updateTask,
  verifyCredential,
  type FactoryRunRow,
} from './factory-runtime';
import {
  provisionDoppler,
  provisionSupabase,
  synchronizeSupabaseRuntime,
} from './factory-secrets';
import { provisionVercel } from './factory-vercel';

type PlatformFactoryInput = {
  runId: string;
  /** Owner/admin tapped Go live. Never set by automatic factory resume. */
  goLiveApproved?: boolean;
};
type PlatformFactoryResult = {
  status: 'blocked' | 'failed' | 'live';
  missingCredentialKeys: readonly string[];
  code?: string;
};

async function failRun(runId: string, message: string): Promise<void> {
  'use step';
  logFactory('run.failed', { runId, message });
  const result = await database().from('platform_onboarding_runs')
    .update({ state: 'failed', last_error_code: 'factory_pipeline_failed' })
    .eq('id', runId);
  if (result.error) throw new Error(`Factory failure state update failed: ${result.error.code}`);
}

async function createDemo(run: FactoryRunRow): Promise<void> {
  let activeTask = 'research-brand';
  try {
    await updateTask(run.id, activeTask, 'running');
    const research = await researchBrand(run);
    await saveArtifact(run.id, 'brand_kit', research as unknown as Record<string, unknown>);
    await verifyCredential(run.id, 'openai.api_key');
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

/** GitHub + Doppler + Supabase only. Never mints {slug}-hq / {slug}-display. */
async function provisionSandboxInfrastructure(run: FactoryRunRow): Promise<void> {
  let activeTask = 'create-github-repository';
  try {
    await updateTask(run.id, activeTask, 'running');
    await provisionGitHub(run);
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
  } catch (error) {
    await updateTask(run.id, activeTask, 'failed', 'factory_task_failed');
    throw error;
  }
}

async function mintProductionHosts(run: FactoryRunRow): Promise<void> {
  if (!mayMintProductionHosts(true)) {
    throw new Error('Production host mint refused without Go live approval.');
  }
  await updateTask(run.id, 'create-vercel-projects', 'running');
  try {
    const prior = await existingResource(run.id, 'github', 'repository');
    if (!prior?.externalId) throw new Error('GitHub repository is required before Go live mint.');
    const repository = prior.externalId;
    await provisionVercel(run, repository, { goLiveApproved: true });
    await synchronizeGitHubDeployment(run, repository);
    await updateTask(run.id, 'create-vercel-projects', 'completed');
  } catch (error) {
    await updateTask(run.id, 'create-vercel-projects', 'failed', 'factory_task_failed');
    throw error;
  }
}

async function blockForCredentials(
  run: FactoryRunRow,
  task: string,
  code: string,
  missingCredentialKeys: readonly string[],
): Promise<PlatformFactoryResult> {
  await updateTask(run.id, task, 'blocked', code);
  await updateRun(run.id, { state: 'blocked', stage: 'credentials', last_error_code: code });
  return { status: 'blocked', missingCredentialKeys, code };
}

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
