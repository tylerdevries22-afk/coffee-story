'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { serverClient } from '@/lib/supabase-server';

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

async function requirePlatformAdmin() {
  const session = await currentSession();
  if (!session || !hasRole(session, 'platform_admin')) return null;
  return session;
}

/** Suspend an active organization (reversible). platform_admin only. */
export async function suspendOrganizationAction(formData: FormData): Promise<void> {
  const session = await requirePlatformAdmin();
  const brandId = text(formData, 'brandId');
  const reason = text(formData, 'reason');
  if (!session || !brandId) redirect('/');
  const client = await serverClient();
  if (!client) redirect(`/organizations/${brandId}?lifecycle=unavailable`);
  const result = await client.rpc('suspend_brand', { p_brand_id: brandId, p_reason: reason || 'Suspended from HQ' });
  if (result.error) redirect(`/organizations/${brandId}?lifecycle=failed`);
  revalidatePath(`/organizations/${brandId}`);
  revalidatePath('/', 'layout');
  redirect(`/organizations/${brandId}?lifecycle=suspended`);
}

/** Restore a suspended organization. Devices stay revoked until re-paired. */
export async function restoreOrganizationAction(formData: FormData): Promise<void> {
  const session = await requirePlatformAdmin();
  const brandId = text(formData, 'brandId');
  if (!session || !brandId) redirect('/');
  const client = await serverClient();
  if (!client) redirect(`/organizations/${brandId}?lifecycle=unavailable`);
  const result = await client.rpc('restore_brand', { p_brand_id: brandId });
  if (result.error) redirect(`/organizations/${brandId}?lifecycle=failed`);
  revalidatePath(`/organizations/${brandId}`);
  revalidatePath('/', 'layout');
  redirect(`/organizations/${brandId}?lifecycle=restored`);
}

/** Terminal offboard — access ends; rows remain for audit until a later purge. */
export async function offboardOrganizationAction(formData: FormData): Promise<void> {
  const session = await requirePlatformAdmin();
  const brandId = text(formData, 'brandId');
  const reason = text(formData, 'reason');
  if (!session || !brandId) redirect('/');
  const client = await serverClient();
  if (!client) redirect(`/organizations/${brandId}?lifecycle=unavailable`);
  const result = await client.rpc('offboard_brand', {
    p_brand_id: brandId,
    p_reason: reason || 'Offboarded from HQ',
  });
  if (result.error) redirect(`/organizations/${brandId}?lifecycle=failed`);
  revalidatePath(`/organizations/${brandId}`);
  revalidatePath('/', 'layout');
  redirect(`/organizations/${brandId}?lifecycle=offboarded`);
}
