/**
 * The write behind "Save draft" on Campaigns, factored out the same way as
 * scheduleDrop (see drop-scheduling.ts) so its error-state mapping is unit
 * testable against a stubbed client.
 *
 * This only ever writes status 'draft'. Publishing a draft into
 * 'scheduled'/'sending' is a distinct, reviewed action that does not exist
 * yet -- `scripts/run-jobs.ts` claims campaigns already sitting in
 * 'scheduled', so a freshly saved draft is inert until something else moves
 * it there. Nothing here enqueues a send.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { hasRole } from './auth';
import type { CampaignActionState } from './campaign-action-state';
import { parseCampaignDraft, type CampaignInput } from './campaign-input';
import type { SessionInfo } from './demo-data';

export type SaveCampaignDraftContext = {
  readonly session: SessionInfo | null;
  readonly brandId: string;
  readonly campaignsEnabled: boolean;
  readonly client: SupabaseClient | null;
};

export async function saveCampaignDraft(
  context: SaveCampaignDraftContext,
  input: CampaignInput,
): Promise<CampaignActionState> {
  if (!context.session || !hasRole(context.session, 'brand_owner')) {
    return { kind: 'error', message: 'Only a brand owner can save a campaign.' };
  }
  const parsed = parseCampaignDraft(input);
  if (!parsed.ok) return { kind: 'error', message: parsed.error };
  if (!context.campaignsEnabled) {
    return { kind: 'error', message: 'Campaigns are not enabled for this organization.' };
  }
  if (!context.client) {
    return { kind: 'error', message: 'This deployment is not connected to Supabase.' };
  }

  const inserted = await context.client.from('campaigns').insert({
    brand_id: context.brandId,
    channel: parsed.draft.channel,
    name: parsed.draft.name,
    subject: parsed.draft.subject,
    body: parsed.draft.body,
    audience: parsed.draft.audience,
    scheduled_at: parsed.draft.scheduledAt,
    status: 'draft',
  }).select('id').maybeSingle();
  if (inserted.error || !inserted.data) {
    return { kind: 'error', message: 'The campaign could not be saved.' };
  }
  return { kind: 'success', message: 'Campaign saved as a draft.' };
}
