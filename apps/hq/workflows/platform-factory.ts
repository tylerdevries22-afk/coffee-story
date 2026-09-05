import { sleep } from 'workflow';

import { buildFactoryApplicationManifest } from '../lib/factory-automation';
import { advanceFactoryRelease } from './factory-release';
import {
  completedFactoryTasks,
  factoryReleaseDependencies,
  loadContentEvidence,
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

type PlatformFactoryInput = { runId: string };
type PlatformFactoryResult = {
  status: 'blocked' | 'failed' | 'live';
  missingCredentialKeys: readonly string[];
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
    await synchronizeGitHubDeployment(run, repository.externalId);
    await updateTask(run.id, activeTask, 'completed');
  } catch (error) {
    await updateTask(run.id, activeTask, 'failed', 'factory_task_failed');
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
  return { status: 'blocked', missingCredentialKeys };
}

export async function runPlatformFactory(input: PlatformFactoryInput): Promise<PlatformFactoryResult> {
  'use workflow';
  try {
    const run = await loadRun(input.runId);
    const completed = new Set(await completedFactoryTasks(run.id));
    if (completed.has('promote-live')) {
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
    if (!completed.has('create-vercel-projects')) {
      await updateRun(run.id, { state: 'running', stage: 'infrastructure', last_error_code: null });
      await provisionHostedInfrastructure(run);
      completed.add('create-vercel-projects');
    }
    await synchronizePublishedContent(run.id, run.tenantSlug);
    const content = await loadContentEvidence(run.id);
    if (content) {
      await synchronizeGitHubArtifactDigest(run, content.artifactDigest);
      await synchronizeDeploymentEvidence(run, content.artifactDigest);
    }
    const release = await advanceFactoryRelease(
      run,
      completed,
      factoryReleaseDependencies(run),
    );
    return { status: release.status, missingCredentialKeys: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Platform factory failed.';
    await failRun(input.runId, message);
    throw error;
  }
}
