'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { serverClient } from '@/lib/supabase-server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function activateOrganizationAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  const brandId = String(formData.get('brandId') ?? '');
  if (!session || !hasRole(session, 'platform_admin') || !UUID.test(brandId)) {
    redirect('/organizations/new');
  }
  const client = await serverClient();
  if (!client) redirect(`/organizations/${brandId}?activation=unavailable`);
  const result = await client.rpc('activate_platform_organization', { p_brand_id: brandId });
  if (result.error?.message.includes('organization_not_ready')) {
    redirect(`/organizations/${brandId}?activation=not-ready`);
  }
  if (result.error || result.data !== true) {
    redirect(`/organizations/${brandId}?activation=failed`);
  }
  revalidatePath('/', 'layout');
  revalidatePath(`/organizations/${brandId}`);
  redirect(`/organizations/${brandId}?activation=complete`);
}
