import {
  dueCampaigns,
  dueDropTransitions,
} from '@platform/engine';

import { jsonError, matchesSecret, notConfigured, serverEnv, serviceDb } from '../../../../lib/api-auth';
import { analyticsMaintenanceCutoffs } from '../../../../lib/analytics-maintenance';
import { delegatedGrantRetentionCutoff } from '../../../../lib/delegated-grant-maintenance';
import { runSquareMaintenance } from '../../../../lib/square-job-maintenance';
import { runTrainingMaintenance } from '../../../../lib/training-maintenance';
import { deliverOperationNotifications } from '../../../../lib/operation-notifications';

export const maxDuration = 300;

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

  const square = await runSquareMaintenance(db, now);

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

  const trainingBootstraps = await runTrainingMaintenance(db);

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
  const operationEscalations = await db.rpc('queue_due_operation_escalations', {
    target_now: now.toISOString(),
  });
  if (operationEscalations.error) throw operationEscalations.error;
  const operationNotifications = await deliverOperationNotifications(db, now);
  const operationsRetention = await db.rpc('apply_operation_retention', {
    target_now: now.toISOString(),
  });
  if (operationsRetention.error) throw operationsRetention.error;

  // Delegated access grants end on their own clock, so the same tick stamps the
  // ones that have run out and drops the ones past retention. Without it a
  // grant is only ever ended by hand, and nothing has ever ended one.
  const delegatedGrants = await db.rpc('prune_delegated_access_grants', {
    ended_before: delegatedGrantRetentionCutoff(now),
  });
  if (delegatedGrants.error) throw delegatedGrants.error;

  return Response.json({
    ok: true,
    drops: dropTransitions.length,
    campaigns: dueCampaignIds.length,
    trainingBootstraps,
    square,
    analytics: { rollups: rollups.data, retention: retention.data },
    delegatedGrants: delegatedGrants.data,
    operations: {
      maintenance: operations.data,
      escalations: operationEscalations.data,
      notifications: operationNotifications,
      retention: operationsRetention.data,
    },
  });
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
