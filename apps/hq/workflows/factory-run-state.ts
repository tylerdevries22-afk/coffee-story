import {
  database,
  logFactory,
  updateRun,
  updateTask,
  type FactoryRunRow,
} from './factory-runtime';

export type PlatformFactoryResult = {
  status: 'blocked' | 'failed' | 'live';
  missingCredentialKeys: readonly string[];
  code?: string;
};

export async function failRun(runId: string, message: string): Promise<void> {
  'use step';
  logFactory('run.failed', { runId, message });
  const result = await database().from('platform_onboarding_runs')
    .update({ state: 'failed', last_error_code: 'factory_pipeline_failed' })
    .eq('id', runId);
  if (result.error) throw new Error(`Factory failure state update failed: ${result.error.code}`);
}

export async function blockForCredentials(
  run: FactoryRunRow,
  task: string,
  code: string,
  missingCredentialKeys: readonly string[],
): Promise<PlatformFactoryResult> {
  await updateTask(run.id, task, 'blocked', code);
  await updateRun(run.id, { state: 'blocked', stage: 'credentials', last_error_code: code });
  return { status: 'blocked', missingCredentialKeys, code };
}
