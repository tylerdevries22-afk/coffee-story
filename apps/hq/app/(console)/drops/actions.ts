'use server';

import { revalidatePath } from 'next/cache';

import { currentSession } from '@/lib/auth';
import { activeModuleKeys } from '@/lib/capabilities';
import { type DropActionState } from '@/lib/drop-action-state';
import { scheduleDrop } from '@/lib/drop-scheduling';
import { serverClient } from '@/lib/supabase-server';
import { selectedOrganizationId } from '@/lib/workspace-scope';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Schedule a drop -- see drop-scheduling.ts for the actual authorization and
 * write. This wrapper only gathers the real session, brand id, module flag,
 * and Supabase client, then turns a fresh success into a page the table on
 * /drops can read back from.
 */
export async function scheduleDropAction(
  _previous: DropActionState,
  formData: FormData,
): Promise<DropActionState> {
  const session = await currentSession();
  const brandId = session ? await selectedOrganizationId(session) : '';
  const dropsEnabled = brandId.length > 0 && (await activeModuleKeys(brandId)).has('growth-drops');
  const state = await scheduleDrop(
    { session, brandId, dropsEnabled, client: await serverClient() },
    {
      itemId: text(formData, 'itemId'),
      startsAt: text(formData, 'startsAt'),
      endsAt: text(formData, 'endsAt'),
    },
  );
  if (state.kind === 'success') revalidatePath('/drops');
  return state;
}
