'use server';

import { revalidatePath } from 'next/cache';

import { normalizeForSave, resolveKioskFlow, type KioskMenuFacts } from '@platform/domain';

import { serverClient } from '@/lib/supabase-server';
import { currentSession, hasRole } from '@/lib/auth';

export type SaveResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: string };

/**
 * The console's first settings write.
 *
 * It goes through the signed-in user's own session, not a service-role client:
 * `brands_update` already permits a brand owner to edit their own brand, so
 * using the policy means this inherits the 0031 fee-terms trigger and the 0034
 * view guards for free instead of re-implementing the first of them by hand.
 *
 * What is persisted is the RESOLVED flow, never the raw form state. That makes
 * the stored object one the device resolver has already accepted, so a client
 * bypassing this form cannot put a shape into brand_config that a kiosk would
 * then have to cope with. `normalizeForSave` additionally drops a tile list
 * that was DERIVED from the menu -- freezing that would silently stop the kiosk
 * following the menu from the moment of the first save.
 */
export async function saveKioskFlow(
  draft: unknown,
  menu: KioskMenuFacts,
  expectedUpdatedAt: string | null,
): Promise<SaveResult> {
  const session = await currentSession();
  // Nav visibility is not authorisation; the page checks too, and so does RLS.
  if (!hasRole(session, 'brand_owner')) {
    return { ok: false, error: 'Only a brand owner can change the kiosk flow.' };
  }

  const client = await serverClient();
  if (!client) return { ok: false, error: 'This deployment has no database configured.' };

  const resolved = resolveKioskFlow(draft, { menu });
  const { data, error } = await client.rpc('set_brand_kiosk_config', {
    config: normalizeForSave(resolved),
    expected_updated_at: expectedUpdatedAt,
  });

  if (error) {
    // The two the editor can actually act on get a sentence a person can read.
    if (error.message.includes('kiosk_config_stale')) {
      return { ok: false, error: 'Someone else saved while you were editing. Reload to see their version.' };
    }
    if (error.message.includes('kiosk_config_too_large')) {
      return { ok: false, error: 'That configuration is too large. Shorten the copy or use shorter image URLs.' };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/kiosk');
  return { ok: true, updatedAt: String(data) };
}
