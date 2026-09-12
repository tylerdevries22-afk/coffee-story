'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { start } from 'workflow/api';

import { currentSession } from '@/lib/auth';
import { canTapGoLive } from '@/lib/go-live-access';
import { serverClient } from '@/lib/supabase-server';
import { runPlatformFactory } from '@/workflows/platform-factory';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Explicit HQ Go live. Mints {slug}-hq + {slug}-display only from this path.
 * Factory completion alone never reaches here.
 */
export async function goLiveOrganizationAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  const brandId = String(formData.get('brandId') ?? '');
  if (!canTapGoLive(session) || !UUID.test(brandId)) {
    redirect('/organizations/new');
  }
  const client = await serverClient();
  if (!client) redirect(`/organizations/${brandId}?golive=unavailable`);

  const brand = await client.from('brands').select('id,slug,status')
    .eq('id', brandId).maybeSingle<{ id: string; slug: string; status: string }>();
  if (brand.error || !brand.data) {
    redirect(`/organizations/${brandId}?golive=failed`);
  }

  // Owner may only go-live their own brand unless platform_admin.
  if (session!.role !== 'platform_admin' && session!.brandId !== brandId) {
    redirect(`/organizations/${brandId}?golive=forbidden`);
  }

  const run = await client.from('platform_onboarding_runs')
    .select('id,state,stage,last_error_code')
    .eq('tenant_slug', brand.data.slug)
    .maybeSingle<{
      id: string; state: string; stage: string; last_error_code: string | null;
    }>();
  if (run.error || !run.data) {
    redirect(`/organizations/${brandId}?golive=no-run`);
  }
  if (run.data.state === 'live') {
    redirect(`/organizations/${brandId}?golive=already-live`);
  }

  try {
    await start(runPlatformFactory, [{ runId: run.data.id, goLiveApproved: true }]);
  } catch {
    redirect(`/organizations/${brandId}?golive=failed`);
  }

  revalidatePath('/', 'layout');
  revalidatePath(`/organizations/${brandId}`);
  redirect(`/organizations/${brandId}?golive=started`);
}
