/**
 * The scheduled tick: flips drops live/ended on their windows and hands due
 * campaigns to the notification service. Run from cron (or a Vercel cron
 * hitting a thin route) every minute or five.
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *
 *   npx tsx scripts/run-jobs.ts
 */
import { createClient } from '@supabase/supabase-js';

import { dueCampaigns, dueDropTransitions } from '@platform/engine';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('run-jobs: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function run() {
  const now = new Date();

  const { data: drops, error: dropsError } = await db
    .from('drops').select('id, status, starts_at, ends_at').in('status', ['scheduled', 'live']);
  if (dropsError) throw dropsError;
  const transitions = dueDropTransitions(
    (drops ?? []).map((drop) => ({ id: drop.id, status: drop.status, startsAt: drop.starts_at, endsAt: drop.ends_at })),
    now,
  );
  for (const transition of transitions) {
    const { error } = await db.from('drops').update({ status: transition.to }).eq('id', transition.id);
    if (error) console.error(`  drop ${transition.id}: ${error.message}`);
    else console.log(`  drop ${transition.id} -> ${transition.to}`);
  }

  const { data: campaigns, error: campaignsError } = await db
    .from('campaigns').select('id, status, scheduled_at').eq('status', 'scheduled');
  if (campaignsError) throw campaignsError;
  const due = dueCampaigns(
    (campaigns ?? []).map((campaign) => ({ id: campaign.id, status: campaign.status, scheduledAt: campaign.scheduled_at })),
    now,
  );
  for (const id of due) {
    // Claim it first so a second tick cannot double-send, then hand off.
    const { error } = await db.from('campaigns').update({ status: 'sending' }).eq('id', id).eq('status', 'scheduled');
    if (error) { console.error(`  campaign ${id}: ${error.message}`); continue; }
    console.log(`  campaign ${id} claimed for sending (delivery worker sends via @platform/engine notifications)`);
  }

  console.log(`tick complete: ${transitions.length} drop transitions, ${due.length} campaigns claimed`);
}

run().catch((error) => {
  console.error('run-jobs failed:', error?.message ?? error);
  process.exit(1);
});
