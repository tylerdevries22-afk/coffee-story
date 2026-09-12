import { sleep } from 'workflow';

import { mayMintProductionHosts } from '@platform/factory';

import { buildFactoryApplicationManifest } from '../lib/factory-automation';
import { provisionGitHub } from './factory-github';
import { synchronizeGitHubDeployment } from './factory-github-actions';
import { researchBrand } from './factory-research';
import {
  existingResource,
  saveArtifact,
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

export async function createDemo(run: FactoryRunRow): Promise<void> {
  'use step';
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
export async function provisionSandboxInfrastructure(run: FactoryRunRow): Promise<void> {
  'use step';
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

/**
 * The point of action for the product lock, and therefore where it is enforced.
 *
 * Takes the approval rather than assuming it. The guard used to read
 * `mayMintProductionHosts(true)`, which is a constant, so the throw below could
 * never fire and the call to provisionVercel passed the same literal on to the
 * guard inside it -- disabling that one too. Nothing minted without approval,
 * but only because the one caller happens to sit inside `if (goLiveApproved)`.
 * Move that call and four separate guards would go on reporting that they were
 * protecting something.
 */
export async function mintProductionHosts(
  run: FactoryRunRow,
  goLiveApproved: boolean,
): Promise<void> {
  'use step';
  if (!mayMintProductionHosts(goLiveApproved)) {
    throw new Error('Production host mint refused without Go live approval.');
  }
  await updateTask(run.id, 'create-vercel-projects', 'running');
  try {
    const prior = await existingResource(run.id, 'github', 'repository');
    if (!prior?.externalId) throw new Error('GitHub repository is required before Go live mint.');
    const repository = prior.externalId;
    await provisionVercel(run, repository, { goLiveApproved });
    await synchronizeGitHubDeployment(run, repository);
    await updateTask(run.id, 'create-vercel-projects', 'completed');
  } catch (error) {
    await updateTask(run.id, 'create-vercel-projects', 'failed', 'factory_task_failed');
    throw error;
  }
}
