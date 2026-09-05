'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { enrollmentResponseInput, submitEnrollmentResponse } from '@/lib/franchise-enrollment';
import { serverClient } from '@/lib/supabase-server';

export async function respondToNetworkEnrollmentAction(formData: FormData): Promise<void> {
  const input = enrollmentResponseInput(formData);
  if (!input) redirect('/network?enrollment=invalid');
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner') || session.brandId !== input.brandId) {
    redirect('/network?enrollment=unauthorized');
  }
  const client = await serverClient();
  if (!client) redirect('/network?enrollment=unavailable');
  const outcome = await submitEnrollmentResponse(
    (args) => client.rpc('respond_to_network_enrollment', args),
    input,
  );
  if (outcome === 'accepted' || outcome === 'rejected') revalidatePath('/network');
  redirect(`/network?enrollment=${outcome}`);
}
