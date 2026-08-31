'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession, hasRole } from '@/lib/auth';
import { parseLocationFeeOverrides, updateLocationFeeOverrides } from '@/lib/franchise-fees';
import { authorizeWorkspaceMutation } from '@/lib/workspace-mutation';

function fail(message: string): never {
  redirect(`/fees?error=${encodeURIComponent(message)}`);
}

export async function saveLocationFeeOverridesAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !session.userId || !hasRole(session, 'platform_admin')) {
    fail('Platform administrator access is required.');
  }
  const parsed = parseLocationFeeOverrides({
    feeBps: formData.get('feeBps'),
    feeBpsTier2: formData.get('feeBpsTier2'),
    tierThresholdCents: formData.get('tierThresholdCents'),
  });
  if (!parsed.ok) fail(parsed.error);
  const locationId = String(formData.get('locationId') ?? '');
  const mutation = await authorizeWorkspaceMutation(session, {
    action: 'fees.location.update', auditHome: true, locationId,
  });
  if (!mutation) fail('The fee update was not authorized or could not be audited.');
  if (!mutation.auditCorrelationId) fail('The fee update has no audit correlation.');
  const environment = serverEnv();
  if (!environment) fail('The trusted fee writer is not configured.');
  const updated = await updateLocationFeeOverrides(serviceDb(environment), {
    ...parsed.draft, actorId: session.userId,
    auditCorrelationId: mutation.auditCorrelationId,
    brandId: mutation.brandId, locationId,
  });
  if (!updated) fail('No matching location was updated.');
  revalidatePath('/fees');
  redirect('/fees?updated=1');
}
