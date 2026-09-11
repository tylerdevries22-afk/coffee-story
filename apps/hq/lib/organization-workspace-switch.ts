import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { SessionInfo } from '@/lib/demo-data';
import { recordPlatformAccess } from '@/lib/platform-access-audit';
import { isConfigured } from '@/lib/supabase-server';
import {
  expiredWorkspaceCookieOptions, LOCATION_COOKIE, ORG_COOKIE, workspaceCookieOptions,
} from '@/lib/workspace-cookie';

/** Audit + set workspace cookies after a successful organization provision. */
export async function switchWorkspaceToProvisionedOrg(input: {
  session: SessionInfo;
  brandId: string;
  locationId: string | null;
  factoryIssue: boolean;
}): Promise<{ kind: 'error'; message: string } | never> {
  const audited = await recordPlatformAccess(input.session, {
    action: 'organizations.provision.select',
    brandId: input.brandId,
    locationId: input.locationId,
    required: true,
    metadata: { source: 'organization_create', surface: 'hq' },
  });
  if (!audited) {
    return {
      kind: 'error',
      message: 'Organization was created but workspace switch could not be audited.',
    };
  }
  const store = await cookies();
  store.set(ORG_COOKIE, input.brandId, workspaceCookieOptions());
  store.set(
    LOCATION_COOKIE,
    input.locationId ?? '',
    input.locationId ? workspaceCookieOptions() : expiredWorkspaceCookieOptions(),
  );
  revalidatePath('/', 'layout');
  redirect(isConfigured()
    ? `/organizations/${input.brandId}${input.factoryIssue ? '?factory=failed' : ''}`
    : '/locations');
}
