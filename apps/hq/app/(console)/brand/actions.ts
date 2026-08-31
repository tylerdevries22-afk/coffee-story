'use server';

import { revalidatePath } from 'next/cache';

import { currentSession, hasRole } from '@/lib/auth';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { brandSettingsPatch } from '@/lib/brand-config';
import { serverClient } from '@/lib/supabase-server';
import { authorizeWorkspaceMutation } from '@/lib/workspace-mutation';

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
  if (!session) return { ok: false, error: 'Your session has expired.' };
  const mutation = await authorizeWorkspaceMutation(session, { action: 'brand.settings.update' });
  if (!mutation) return { ok: false, error: 'This brand settings change was not authorized.' };
  const client = await serverClient();
  if (!client) return { ok: false, error: 'This deployment has no database configured.' };

  const config = brandSettingsPatch(draft);
  const environment = mutation.serviceRole ? serverEnv() : null;
  if (mutation.serviceRole && (!environment || !session.userId || !mutation.auditCorrelationId)) {
    return { ok: false, error: 'The trusted brand settings writer is not configured.' };
  }
  const { data, error } = mutation.serviceRole
    ? await serviceDb(environment!).rpc('set_platform_brand_settings_config', {
      p_actor_id: session.userId,
      p_brand_id: mutation.brandId,
      p_config: config,
      p_correlation_id: mutation.auditCorrelationId,
      p_expected_updated_at: expectedUpdatedAt,
    })
    : await client.rpc('set_brand_settings_config', {
      config,
      expected_updated_at: expectedUpdatedAt,
    });
  if (error) {
    if (error.message.includes('brand_config_stale')) {
      return { ok: false, error: 'Someone else saved while you were editing. Reload to see their version.' };
    }
    if (error.message.includes('brand_config_too_large')) {
      return { ok: false, error: 'Those settings are too large. Shorten the copy or badge labels.' };
    }
    return { ok: false, error: 'Brand settings could not be saved.' };
  }
  revalidatePath('/brand');
  return { ok: true, updatedAt: String(data) };
}
