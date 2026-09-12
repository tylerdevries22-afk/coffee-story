/**
 * The write behind "Schedule a drop", factored out of the server action so
 * its error-state mapping can run against a stubbed client in a unit test --
 * `apps/hq/app/(console)/drops/actions.ts` only gathers the real session,
 * brand id, module flag, and Supabase client and hands them here.
 *
 * The insert itself runs through the RLS-bound client: `drops_write`'s
 * `with check (app.is_brand_owner(brand_id))` is the real authorization, not
 * the `hasRole` check below. That check exists only to fail fast with a
 * plain-language message instead of a raw Postgres error.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { hasRole } from './auth';
import type { DropActionState } from './drop-action-state';
import type { SessionInfo } from './demo-data';
import { parseDropDraft, type DropInput } from './drop-input';

export type ScheduleDropContext = {
  readonly session: SessionInfo | null;
  readonly brandId: string;
  readonly dropsEnabled: boolean;
  readonly client: SupabaseClient | null;
};

export async function scheduleDrop(
  context: ScheduleDropContext,
  input: DropInput,
): Promise<DropActionState> {
  if (!context.session || !hasRole(context.session, 'brand_owner')) {
    return { kind: 'error', message: 'Only a brand owner can schedule a drop.' };
  }
  const parsed = parseDropDraft(input);
  if (!parsed.ok) return { kind: 'error', message: parsed.error };
  if (!context.dropsEnabled) {
    return { kind: 'error', message: 'Drops are not enabled for this organization.' };
  }
  if (!context.client) {
    return { kind: 'error', message: 'This deployment is not connected to Supabase.' };
  }

  // menu_items' foreign key carries no brand check of its own -- a foreign
  // key is enforced with the definer's privileges, not the caller's RLS -- so
  // this confirms the chosen item is actually this brand's before a new drop
  // can reference it.
  const item = await context.client.from('menu_items').select('id')
    .eq('brand_id', context.brandId).eq('id', parsed.draft.itemId).maybeSingle();
  if (item.error || !item.data) {
    return { kind: 'error', message: 'Choose a menu item from this brand.' };
  }

  const inserted = await context.client.from('drops').insert({
    brand_id: context.brandId,
    item_id: parsed.draft.itemId,
    starts_at: parsed.draft.startsAt,
    ends_at: parsed.draft.endsAt,
    status: 'scheduled',
  }).select('id').maybeSingle();
  if (inserted.error || !inserted.data) {
    return { kind: 'error', message: 'The drop could not be scheduled.' };
  }
  return { kind: 'success', message: 'Drop scheduled.' };
}
