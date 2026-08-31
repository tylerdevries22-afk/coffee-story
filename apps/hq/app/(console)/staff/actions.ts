'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import type { SessionInfo } from '@/lib/demo-data';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { parseStaffDraft } from '@/lib/staff-input';
import { resolveOrInviteStaffUser, staffInvitationRedirectUrl } from '@/lib/staff-admin';
import { serverClient } from '@/lib/supabase-server';
import { authorizeWorkspaceMutation, type WorkspaceMutation } from '@/lib/workspace-mutation';

function fail(message: string): never {
  redirect(`/staff?error=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function inviteRedirectUrl(): string | null {
  return staffInvitationRedirectUrl({
    hqUrl: process.env.NEXT_PUBLIC_HQ_URL,
    vercelEnvironment: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
  });
}

async function validateLocationScope(
  brandId: string,
  locationIds: readonly string[],
): Promise<boolean> {
  if (locationIds.length === 0) return true;
  const client = await serverClient();
  if (!client) return false;
  const result = await client.from('locations').select('id')
    .eq('brand_id', brandId).in('id', [...locationIds])
    .returns<{ id: string }[]>();
  return !result.error && result.data?.length === locationIds.length;
}

async function manageMember(
  session: SessionInfo,
  mutation: WorkspaceMutation,
  action: 'staff.invite' | 'staff.update' | 'staff.remove',
  userId: string,
  role: string,
  locationIds: readonly string[],
  remove = false,
): Promise<string | null> {
  const client = await serverClient();
  if (!client) return 'This deployment is not connected to Supabase.';
  const environment = mutation.serviceRole ? serverEnv() : null;
  if (mutation.serviceRole && (!environment || !session.userId || !mutation.auditCorrelationId)) {
    return 'The audited staff writer is not configured.';
  }
  const input = {
    p_brand_id: mutation.brandId,
    p_location_ids: [...locationIds],
    p_remove: remove,
    p_role: role,
    p_user_id: userId,
  };
  const result = mutation.serviceRole
    ? await serviceDb(environment!).rpc('manage_platform_brand_member', {
      ...input,
      p_action: action,
      p_actor_id: session.userId,
      p_correlation_id: mutation.auditCorrelationId,
    })
    : await client.rpc('manage_brand_member', input);
  if (!result.error) return null;
  if (result.error.message.includes('last_brand_owner_required')) {
    return 'Assign another brand owner before removing the last one.';
  }
  return 'The staff access change was refused.';
}

export async function inviteStaffAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) fail('Only a brand owner can invite staff.');
  const parsed = parseStaffDraft({
    email: formData.get('email'), locationIds: formData.getAll('locationIds'),
    role: formData.get('role'),
  });
  if (!parsed.ok) fail(parsed.error);
  const mutation = await authorizeWorkspaceMutation(session, { action: 'staff.invite' });
  if (!mutation) fail('You are not authorized to invite staff to this organization.');
  if (!await validateLocationScope(mutation.brandId, parsed.draft.locationIds)) {
    fail('One or more selected locations no longer belong to this organization.');
  }
  const environment = serverEnv();
  const callback = inviteRedirectUrl();
  if (!environment || !callback) fail('Staff invitations are not configured for this deployment.');

  try {
    const identity = await resolveOrInviteStaffUser(
      serviceDb(environment).auth.admin, parsed.draft.email, callback,
    );
    const error = await manageMember(
      session, mutation, 'staff.invite', identity.userId,
      parsed.draft.role, parsed.draft.locationIds,
    );
    if (error) throw new Error(error);
  } catch {
    fail('The invitation could not be prepared. Try again without changing the email address.');
  }
  revalidatePath('/staff');
  redirect('/staff?updated=prepared');
}

export async function updateStaffAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) fail('Only a brand owner can update staff.');
  const parsed = parseStaffDraft({
    email: 'member@example.invalid', locationIds: formData.getAll('locationIds'),
    role: formData.get('role'),
  });
  if (!parsed.ok) fail(parsed.error);
  const mutation = await authorizeWorkspaceMutation(session, { action: 'staff.update' });
  if (!mutation || !await validateLocationScope(mutation.brandId, parsed.draft.locationIds)) {
    fail('The requested staff scope is not authorized.');
  }
  const error = await manageMember(
    session, mutation, 'staff.update', text(formData, 'userId'),
    parsed.draft.role, parsed.draft.locationIds,
  );
  if (error) fail(error);
  revalidatePath('/staff');
  redirect('/staff?updated=changed');
}

export async function removeStaffAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) fail('Only a brand owner can remove staff.');
  const mutation = await authorizeWorkspaceMutation(session, { action: 'staff.remove' });
  if (!mutation) fail('The requested staff change is not authorized.');
  const error = await manageMember(
    session, mutation, 'staff.remove', text(formData, 'userId'), 'staff', [], true,
  );
  if (error) fail(error);
  revalidatePath('/staff');
  redirect('/staff?updated=removed');
}
