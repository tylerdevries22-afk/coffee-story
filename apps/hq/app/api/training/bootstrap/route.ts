import { randomUUID } from 'node:crypto';

import { start } from 'workflow/api';

import {
  normalizeTrainingProfile,
  TRAINING_PIPELINE_VERSION,
  validateTrainingProfile,
  type TenantTrainingProfile,
} from '../../../../lib/training-bootstrap';
import { trainingProfileFingerprint } from '../../../../lib/training-fingerprint';
import {
  authenticate,
  corsPreflight,
  jsonError,
  jsonWithCors,
  notConfigured,
  parseJsonBody,
  serverEnv,
  serviceDb,
} from '../../../../lib/api-auth';
import { bootstrapTenantTraining } from '../../../../workflows/tenant-training-bootstrap';

type BootstrapBody = { profile?: TenantTrainingProfile; force?: boolean };

const MANAGER_ROLES = new Set(['platform_admin', 'brand_owner']);

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function POST(request: Request): Promise<Response> {
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const auth = await authenticate(request, db);
  if (auth instanceof Response) return auth;
  if (!auth.claims.role || !MANAGER_ROLES.has(auth.claims.role)) {
    return jsonError(403, 'forbidden', 'Only tenant owners can generate brand-wide training.');
  }
  const body = await parseJsonBody<BootstrapBody>(request);
  if (body instanceof Response) return body;
  if (!body.profile) return jsonError(400, 'invalid_profile', 'A tenant training profile is required.');
  const profile = normalizeTrainingProfile(body.profile);
  const issues = validateTrainingProfile(profile);
  if (issues.length > 0) return jsonError(400, 'invalid_profile', issues.join('; '));
  const storedProfile = await db.rpc('store_training_profile', {
    target_brand: auth.claims.brand_id,
    tenant_profile: profile,
  });
  if (storedProfile.error) {
    return jsonError(500, 'profile_save_failed', 'Could not save the tenant training profile.');
  }

  if (!body.force) {
    const published = await db.from('training_releases').select('id, version, published_at').eq('brand_id', auth.claims.brand_id).eq('status', 'published').maybeSingle();
    if (published.error) return jsonError(500, 'release_lookup_failed', 'Could not check the current training release.');
    if (published.data) return jsonWithCors({ status: 'already_published', release: published.data });
  }

  const stableFingerprint = trainingProfileFingerprint(profile);
  const fingerprint = body.force
    ? `${stableFingerprint.slice(0, 32)}${randomUUID().replaceAll('-', '')}`
    : stableFingerprint;
  const existing = body.force ? { data: null, error: null } : await db.from('training_bootstrap_runs').select('id, status, stage, progress').eq('brand_id', auth.claims.brand_id).eq('profile_fingerprint', fingerprint).eq('pipeline_version', TRAINING_PIPELINE_VERSION).maybeSingle();
  if (existing.error) return jsonError(500, 'run_lookup_failed', 'Could not check existing training automation.');
  if (existing.data && existing.data.status !== 'failed' && existing.data.status !== 'cancelled') {
    return jsonWithCors({ status: 'existing', run: existing.data });
  }

  const runId = existing.data?.id ?? randomUUID();
  const requestedBy = await db.from('brand_users').select('id').eq('brand_id', auth.claims.brand_id).eq('user_id', auth.userId).single<{ id: string }>();
  if (requestedBy.error) return jsonError(403, 'no_membership', 'Your tenant membership is not active.');
  const values = {
    id: runId,
    brand_id: auth.claims.brand_id,
    profile_fingerprint: fingerprint,
    pipeline_version: TRAINING_PIPELINE_VERSION,
    trigger_kind: body.force ? 'manual' : 'empty_tenant',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    error_code: null,
    error_detail: {},
    requested_by: requestedBy.data.id,
    started_at: null,
    finished_at: null,
  };
  const saved = existing.data
    ? await db.from('training_bootstrap_runs').update(values).eq('id', runId)
    : await db.from('training_bootstrap_runs').insert(values);
  if (saved.error?.code === '23505' && !body.force) {
    const winner = await db.from('training_bootstrap_runs').select('id, status, stage, progress').eq('brand_id', auth.claims.brand_id).eq('profile_fingerprint', fingerprint).eq('pipeline_version', TRAINING_PIPELINE_VERSION).single();
    if (!winner.error) return jsonWithCors({ status: 'existing', run: winner.data });
  }
  if (saved.error) return jsonError(500, 'run_create_failed', 'Could not create the training automation run.');

  try {
    const workflowRun = await start(bootstrapTenantTraining, [{ brandId: auth.claims.brand_id, runId, profile }]);
    return jsonWithCors({ status: 'queued', runId, workflowRunId: workflowRun.runId }, 202);
  } catch {
    await db.from('training_bootstrap_runs').update({ status: 'failed', stage: 'queue', error_code: 'workflow_start_failed', finished_at: new Date().toISOString() }).eq('id', runId);
    return jsonError(503, 'workflow_unavailable', 'Training automation could not be started. Try again shortly.');
  }
}
