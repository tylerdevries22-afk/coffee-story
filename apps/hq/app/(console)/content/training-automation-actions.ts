'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { start } from 'workflow/api';

import {
  normalizeTrainingProfile,
  TRAINING_PIPELINE_VERSION,
  validateTrainingProfile,
  type TenantTrainingProfile,
} from '@/lib/training-bootstrap';
import { trainingProfileFingerprint } from '@/lib/training-fingerprint';
import { bootstrapTenantTraining } from '@/workflows/tenant-training-bootstrap';

import {
  isFailure,
  managerContext,
  retryWrite,
  type Failure,
} from './actions-shared';

export async function startTrainingAutomation(
  input: unknown,
): Promise<Failure | { ok: true; runId: string; persisted: boolean }> {
  if (!isTrainingProfilePayload(input)) return { ok: false, error: 'The tenant training profile is invalid.' };
  const requestedProfile: TenantTrainingProfile = input;
  const profile = normalizeTrainingProfile(requestedProfile);
  const issues = validateTrainingProfile(profile);
  if (issues.length > 0) return { ok: false, error: issues.join('; ') };
  const context = await managerContext('content.training.automation.start');
  if (isFailure(context)) return context;
  if (!context) return { ok: true, persisted: false, runId: `preview-${randomUUID()}` };
  const stored = await context.privileged.rpc('store_training_profile', {
    target_brand: context.brandId, tenant_profile: profile,
  });
  if (stored.error) return { ok: false, error: 'The tenant training profile could not be saved.' };
  const runId = randomUUID();
  const fingerprint = `${trainingProfileFingerprint(profile).slice(0, 32)}${runId.replaceAll('-', '')}`;
  const queued = await retryWrite(() => context.privileged.from('training_bootstrap_runs').insert({
    id: runId,
    brand_id: context.brandId,
    profile_fingerprint: fingerprint,
    pipeline_version: TRAINING_PIPELINE_VERSION,
    trigger_kind: 'manual',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    requested_by: context.brandUserId,
  }));
  if (queued.error) return { ok: false, error: 'The training research run could not be queued.' };
  try {
    await start(bootstrapTenantTraining, [{ brandId: context.brandId, runId, profile }]);
  } catch {
    await context.privileged.from('training_bootstrap_runs').update({
      status: 'failed', stage: 'queue', error_code: 'workflow_start_failed', finished_at: new Date().toISOString(),
    }).eq('id', runId).eq('brand_id', context.brandId);
    return { ok: false, error: 'Training research could not start. Try again shortly.' };
  }
  revalidatePath('/content');
  return { ok: true, persisted: true, runId };
}
function isTrainingProfilePayload(value: unknown): value is TenantTrainingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  if (typeof profile.businessName !== 'string' || typeof profile.industry !== 'string'
      || typeof profile.locale !== 'string') return false;
  for (const key of ['products', 'services', 'complianceTopics'] as const) {
    const list = profile[key];
    if (list !== undefined && (!Array.isArray(list) || !list.every((item) => typeof item === 'string'))) return false;
  }
  if (profile.templateKey !== undefined && typeof profile.templateKey !== 'string') return false;
  if (profile.templateVersion !== undefined && typeof profile.templateVersion !== 'number') return false;
  return (profile.website === undefined || typeof profile.website === 'string')
    && (profile.brandVoice === undefined || typeof profile.brandVoice === 'string');
}
