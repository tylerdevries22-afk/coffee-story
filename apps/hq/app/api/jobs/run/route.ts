import { randomUUID } from 'node:crypto';

import { dueCampaigns, dueDropTransitions } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { start } from 'workflow/api';

import { jsonError, matchesSecret, notConfigured, serverEnv, serviceDb } from '../../../../lib/api-auth';
import {
  TRAINING_PIPELINE_VERSION,
  resolveTenantTrainingProfile,
} from '../../../../lib/training-bootstrap';
import { analyticsMaintenanceCutoffs } from '../../../../lib/analytics-maintenance';
import { trainingProfileFingerprint } from '../../../../lib/training-fingerprint';
import { bootstrapTenantTraining } from '../../../../workflows/tenant-training-bootstrap';

type TrainingBrandRow = { id: string; name: string; brand_config: unknown };
type TrainingRunRow = { id: string; brand_id: string; profile_fingerprint: string; status: string; updated_at: string; retry_count: number; next_attempt_at: string | null };
type TrainingReleaseRow = { brand_id: string; bootstrap_run_id: string | null; manifest: unknown };

async function trainingScanRows(db: SupabaseClient): Promise<{ brands: TrainingBrandRow[]; runs: TrainingRunRow[]; releases: TrainingReleaseRow[] }> {
  const brands: TrainingBrandRow[] = [];
  const runs: TrainingRunRow[] = [];
  const releases: TrainingReleaseRow[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await db.from('brands').select('id, name, brand_config').order('created_at').range(offset, offset + pageSize - 1).returns<TrainingBrandRow[]>();
    if (page.error) throw page.error;
    brands.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) break;
  }
  for (let offset = 0; ; offset += pageSize) {
    const page = await db.from('training_bootstrap_runs').select('id, brand_id, profile_fingerprint, status, updated_at, retry_count, next_attempt_at').eq('pipeline_version', TRAINING_PIPELINE_VERSION).range(offset, offset + pageSize - 1).returns<TrainingRunRow[]>();
    if (page.error) throw page.error;
    runs.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) break;
  }
  for (let offset = 0; ; offset += pageSize) {
    const page = await db.from('training_releases').select('brand_id, bootstrap_run_id, manifest').eq('status', 'published').range(offset, offset + pageSize - 1).returns<TrainingReleaseRow[]>();
    if (page.error) throw page.error;
    releases.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) break;
  }
  return { brands, runs, releases };
}

function healthyRelease(release: TrainingReleaseRow | undefined, runId: string | undefined): boolean {
  if (!release || release.bootstrap_run_id !== runId || !release.manifest || typeof release.manifest !== 'object') return false;
  const modules = (release.manifest as { modules?: unknown }).modules;
  return Array.isArray(modules) && modules.length >= 2;
}

/**
 * POST /api/jobs/run — the scheduled tick (Vercel Cron via vercel.json;
 * Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when the
 * env var is set). Applies the engine's pure selectors: drop windows open
 * and close, due campaigns move to sent. Campaign delivery itself (push/SMS
 * fan-out) arrives with a provider; until then the transition is recorded
 * with delivered: 0 so the console shows the truth.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError(501, 'not_configured', 'CRON_SECRET is not set on this deployment.');
  // Constant-time, like the Square callback next door: `!==` returns as soon
  // as two bytes differ, which leaks the shared secret one character at a
  // time to anyone who can measure the difference.
  if (!matchesSecret(request.headers.get('authorization'), `Bearer ${secret}`)) {
    return jsonError(401, 'unauthorized', 'Bad cron secret.');
  }
  const env = serverEnv();
  if (!env) return notConfigured();
  const db = serviceDb(env);
  const now = new Date();

  const drops = await db
    .from('drops')
    .select('id, status, starts_at, ends_at')
    .in('status', ['scheduled', 'live'])
    .returns<{ id: string; status: 'scheduled' | 'live'; starts_at: string; ends_at: string }[]>();
  if (drops.error) throw drops.error;
  const dropTransitions = dueDropTransitions(
    (drops.data ?? []).map((drop) => ({
      id: drop.id,
      status: drop.status,
      startsAt: drop.starts_at,
      endsAt: drop.ends_at,
    })),
    now,
  );
  for (const transition of dropTransitions) {
    const moved = await db.from('drops').update({ status: transition.to }).eq('id', transition.id);
    if (moved.error) throw moved.error;
  }

  const campaigns = await db
    .from('campaigns')
    .select('id, status, scheduled_at')
    .eq('status', 'scheduled')
    .returns<{ id: string; status: 'scheduled'; scheduled_at: string | null }[]>();
  if (campaigns.error) throw campaigns.error;
  const dueCampaignIds = dueCampaigns(
    (campaigns.data ?? []).map((campaign) => ({
      id: campaign.id,
      status: campaign.status,
      scheduledAt: campaign.scheduled_at,
    })),
    now,
  );
  for (const id of dueCampaignIds) {
    const sent = await db
      .from('campaigns')
      .update({ status: 'sent', stats: { delivered: 0, note: 'no delivery provider configured' } })
      .eq('id', id)
      .eq('status', 'scheduled');
    if (sent.error) throw sent.error;
  }

  let trainingBootstraps = 0;
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_RESEARCH_MODEL) {
    const scan = await trainingScanRows(db);
    for (const brand of scan.brands) {
      if (trainingBootstraps >= 2) break;
      const profile = resolveTenantTrainingProfile(brand.name, brand.brand_config);
      const fingerprint = trainingProfileFingerprint(profile);
      const brandRuns = scan.runs.filter((run) => run.brand_id === brand.id);
      const matching = brandRuns.find((run) => run.profile_fingerprint === fingerprint);
      const release = scan.releases.find((candidate) => candidate.brand_id === brand.id);
      const activeStatuses = ['queued', 'researching', 'generating', 'validating'];
      const active = matching && activeStatuses.includes(matching.status);
      const stale = active && Date.now() - new Date(matching.updated_at).getTime() > 2 * 60 * 60 * 1_000;
      const waiting = matching?.next_attempt_at && new Date(matching.next_attempt_at).getTime() > Date.now();
      if (healthyRelease(release, matching?.id) || (active && !stale) || waiting || (matching?.retry_count ?? 0) >= 8) continue;
      const runId = matching?.id ?? randomUUID();
      const retryCount = matching ? matching.retry_count + 1 : 0;
      const values = {
        id: runId,
        brand_id: brand.id,
        profile_fingerprint: fingerprint,
        pipeline_version: TRAINING_PIPELINE_VERSION,
        trigger_kind: brandRuns.length > 0 ? 'profile_changed' : 'empty_tenant',
        status: 'queued',
        stage: 'queued',
        progress: 0,
        retry_count: retryCount,
        next_attempt_at: retryCount > 0 ? new Date(Date.now() + Math.min(24, 2 ** retryCount) * 60 * 60 * 1_000).toISOString() : null,
        error_code: null,
        error_detail: {},
        started_at: null,
        finished_at: null,
      };
      const created = matching
        ? await db.from('training_bootstrap_runs').update(values).eq('id', runId).eq('brand_id', brand.id)
        : await db.from('training_bootstrap_runs').insert(values);
      if (created.error) throw created.error;
      try {
        await start(bootstrapTenantTraining, [{ brandId: brand.id, runId, profile }]);
        trainingBootstraps += 1;
      } catch {
        await db.from('training_bootstrap_runs').update({ status: 'failed', stage: 'queue', error_code: 'workflow_start_failed', finished_at: new Date().toISOString() }).eq('id', runId);
      }
    }
  }

  const analyticsCutoffs = analyticsMaintenanceCutoffs(now);
  const rollups = await db.rpc('refresh_analytics_rollups', {
    rebuild_from: analyticsCutoffs.rebuildFrom,
  });
  if (rollups.error) throw rollups.error;
  const retention = await db.rpc('prune_analytics_retention', {
    raw_before: analyticsCutoffs.rawBefore,
    hourly_before: analyticsCutoffs.hourlyBefore,
    daily_before: analyticsCutoffs.dailyBefore,
  });
  if (retention.error) throw retention.error;

  // The same scheduled tick owns operations lifecycle work. The database
  // function is idempotent, tenant-feature-gated, and snapshots each task at
  // materialization time; a delayed Vercel invocation safely catches up.
  const operations = await db.rpc('run_operation_maintenance', {
    target_now: now.toISOString(),
    target_horizon_hours: 336,
  });
  if (operations.error) throw operations.error;
  const operationsRetention = await db.rpc('apply_operation_retention', {
    target_now: now.toISOString(),
  });
  if (operationsRetention.error) throw operationsRetention.error;

  return Response.json({
    ok: true,
    drops: dropTransitions.length,
    campaigns: dueCampaignIds.length,
    trainingBootstraps,
    analytics: { rollups: rollups.data, retention: retention.data },
    operations: { maintenance: operations.data, retention: operationsRetention.data },
  });
}
