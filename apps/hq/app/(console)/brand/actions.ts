'use server';

import { revalidatePath } from 'next/cache';

import { currentSession, hasRole } from '@/lib/auth';
import { brandSettingsPatch } from '@/lib/brand-config';
import { serverClient } from '@/lib/supabase-server';
import { selectedOrganizationId } from '@/lib/workspace-scope';

export type SaveBrandResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: string };

/** Saves the bounded editor patch through the caller's RLS-scoped session. */
export async function saveBrandConfig(
  draft: unknown,
  expectedUpdatedAt: string | null,
): Promise<SaveBrandResult> {
  const session = await currentSession();
  if (!hasRole(session, 'brand_owner')) {
    return { ok: false, error: 'Only a brand owner can change brand settings.' };
  }
  if (!session || await selectedOrganizationId(session) !== session.brandId) {
    return { ok: false, error: 'Cross-organization settings changes require the audited support workflow.' };
  }
  const client = await serverClient();
  if (!client) return { ok: false, error: 'This deployment has no database configured.' };

  const { data, error } = await client.rpc('set_brand_settings_config', {
    config: brandSettingsPatch(draft),
    expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    if (error.message.includes('brand_config_stale')) {
      return { ok: false, error: 'Someone else saved while you were editing. Reload to see their version.' };
    }
    if (error.message.includes('brand_config_too_large')) {
      return { ok: false, error: 'Those settings are too large. Shorten the copy or badge labels.' };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath('/brand');
  return { ok: true, updatedAt: String(data) };
}
