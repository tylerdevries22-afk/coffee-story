import { dueCampaigns } from '@platform/engine';

import { jsonError, matchesSecret, notConfigured, serverEnv, serviceDb } from '../../../../lib/api-auth';
import { analyticsMaintenanceCutoffs } from '../../../../lib/analytics-maintenance';
import { runIndependentCronStages } from '../../../../lib/cron-stage-runner';
import { delegatedGrantRetentionCutoff } from '../../../../lib/delegated-grant-maintenance';
import { runConnectorOAuthLifecycle } from '../../../../lib/connector-oauth-lifecycle-runner';
import { runSquareMaintenance } from '../../../../lib/square-job-maintenance';
import { runTrainingMaintenance } from '../../../../lib/training-maintenance';
import { deliverOperationNotifications } from '../../../../lib/operation-notifications';

export const maxDuration = 300;
const DROP_BATCH_SIZE = 200;
const DROP_MAX_BATCHES = 5;

/**
 * The scheduled tick, reached as GET from Vercel Cron (via vercel.json) and as
 * POST from a manual run. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * automatically when the env var is set. Applies the engine's pure selectors:
 * drop windows open and close, due campaigns move to sent. Campaign delivery
 * itself (push/SMS fan-out) arrives with a provider; until then the transition
 * is recorded with delivered: 0 so the console shows the truth.
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
  const stages = await runIndependentCronStages({
    drops: async () => {
      let advanced = 0;
      for (let batch = 0; batch < DROP_MAX_BATCHES; batch += 1) {
        const result = await db.rpc('advance_due_drop_batch', {
          target_now: now.toISOString(),
          target_limit: DROP_BATCH_SIZE,
        });
        if (result.error) throw result.error;
        const rows = result.data;
        const count = Array.isArray(rows) ? rows.length : rows == null ? 0 : 1;
        advanced += count;
        if (count < DROP_BATCH_SIZE) break;
      }
      return advanced;
    },
    campaigns: async () => {
      const result = await db.from('campaigns').select('id, status, scheduled_at')
        .eq('status', 'scheduled')
        .returns<{ id: string; status: 'scheduled'; scheduled_at: string | null }[]>();
      if (result.error) throw result.error;
      const ids = dueCampaigns((result.data ?? []).map((campaign) => ({
        id: campaign.id, status: campaign.status, scheduledAt: campaign.scheduled_at,
      })), now);
      for (const id of ids) {
        const sent = await db.from('campaigns')
          .update({ status: 'sent', stats: { delivered: 0, note: 'no delivery provider configured' } })
          .eq('id', id).eq('status', 'scheduled');
        if (sent.error) throw sent.error;
      }
      return ids.length;
    },
    training: () => runTrainingMaintenance(db),
    analytics: async () => {
      const cutoffs = analyticsMaintenanceCutoffs(now);
      const rollups = await db.rpc('refresh_analytics_rollups', { rebuild_from: cutoffs.rebuildFrom });
      if (rollups.error) throw rollups.error;
      const retention = await db.rpc('prune_analytics_retention', {
        raw_before: cutoffs.rawBefore, hourly_before: cutoffs.hourlyBefore, daily_before: cutoffs.dailyBefore,
      });
      if (retention.error) throw retention.error;
      return { rollups: rollups.data, retention: retention.data };
    },
    operations: async () => {
      const maintenance = await db.rpc('run_operation_maintenance', {
        target_now: now.toISOString(), target_horizon_hours: 336,
      });
      if (maintenance.error) throw maintenance.error;
      const escalations = await db.rpc('queue_due_operation_escalations', { target_now: now.toISOString() });
      if (escalations.error) throw escalations.error;
      const notifications = await deliverOperationNotifications(db, now);
      const retention = await db.rpc('apply_operation_retention', { target_now: now.toISOString() });
      if (retention.error) throw retention.error;
      return { maintenance: maintenance.data, escalations: escalations.data, notifications, retention: retention.data };
    },
    delegatedGrants: async () => {
      const result = await db.rpc('prune_delegated_access_grants', {
        ended_before: delegatedGrantRetentionCutoff(now),
      });
      if (result.error) throw result.error;
      return result.data;
    },
    connectorLifecycle: () => runConnectorOAuthLifecycle(db, now),
    square: () => runSquareMaintenance(db, now),
  });

  const { training, ...results } = stages;
  return Response.json({ ok: true, ...results, trainingBootstraps: training });
}

/**
 * GET /api/jobs/run — the same tick, under the method Vercel Cron actually
 * uses. Cron invokes a scheduled path with GET and offers no way to choose
 * another; this route was POST-only, so every tick since the schedule was
 * added answered 405 and none of the work above ran. The 405 is invisible
 * from the outside: nothing retries it and nothing alerts on it.
 *
 * POST stays for manual invocation with the same bearer secret.
 * `lib/cron-contract.test.ts` fails if a scheduled path loses its GET again.
 */
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
