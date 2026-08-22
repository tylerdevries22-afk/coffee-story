import { dueCampaigns, dueDropTransitions } from '@platform/engine';

import { jsonError, matchesSecret, notConfigured, serverEnv, serviceDb } from '../../../../lib/api-auth';

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

  return Response.json({
    ok: true,
    drops: dropTransitions.length,
    campaigns: dueCampaignIds.length,
  });
}
