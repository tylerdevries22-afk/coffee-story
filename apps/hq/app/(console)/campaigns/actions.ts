'use server';

import { revalidatePath } from 'next/cache';

import { currentSession } from '@/lib/auth';
import { activeModuleKeys, consoleCapabilitiesOf } from '@/lib/capabilities';
import { type CampaignActionState } from '@/lib/campaign-action-state';
import { saveCampaignDraft } from '@/lib/campaign-drafting';
import { serverClient } from '@/lib/supabase-server';
import { selectedOrganizationId } from '@/lib/workspace-scope';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Save a campaign as a draft -- see campaign-drafting.ts for the actual
 * authorization, validation, and write (which never enqueues a send). This
 * wrapper only gathers the real session, brand id, module flag, and Supabase
 * client, then revalidates /campaigns so a saved draft shows up in its table.
 */
export async function saveCampaignDraftAction(
  _previous: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const session = await currentSession();
  const brandId = session ? await selectedOrganizationId(session) : '';
  const campaignsEnabled = brandId.length > 0
    && consoleCapabilitiesOf(await activeModuleKeys(brandId)).growth;
  const state = await saveCampaignDraft(
    { session, brandId, campaignsEnabled, client: await serverClient() },
    {
      name: text(formData, 'name'),
      channel: text(formData, 'channel'),
      audience: text(formData, 'audience'),
      subject: text(formData, 'subject'),
      message: text(formData, 'message'),
      scheduledAt: text(formData, 'scheduledAt'),
    },
  );
  if (state.kind === 'success') revalidatePath('/campaigns');
  return state;
}
