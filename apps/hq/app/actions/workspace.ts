'use server';

/** Re-authorized workspace selection with a serializable client result. */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { currentSession } from '@/lib/auth';
import { recordPlatformAccess } from '@/lib/platform-access-audit';
import {
  authorizeLocation,
  authorizeOrganization,
  selectedOrganizationId,
} from '@/lib/workspace-scope';
import {
  expiredWorkspaceCookieOptions,
  isWorkspaceCookieValue,
  LOCATION_COOKIE,
  ORG_COOKIE,
  workspaceCookieOptions,
} from '@/lib/workspace-cookie';

export type WorkspaceActionState =
  | { readonly status: 'idle' }
  | { readonly status: 'success'; readonly selectedId: string; readonly changed: boolean }
  | { readonly status: 'error'; readonly message: string };

const SESSION_ERROR = 'Your session expired. Sign in again.';
const SWITCH_ERROR = 'We could not switch workspaces. Try again.';

function failure(message: string): WorkspaceActionState {
  return { status: 'error', message };
}

function success(selectedId: string, changed: boolean): WorkspaceActionState {
  return { status: 'success', selectedId, changed };
}

export async function selectOrganization(
  _previous: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const session = await currentSession();
    if (!session) return failure(SESSION_ERROR);
    const posted = String(formData.get('orgId') ?? '');
    if (!isWorkspaceCookieValue(posted)) return failure('Choose a valid organization.');
    const authorized = await authorizeOrganization(session, posted);
    if (!authorized) return failure('That organization is no longer available.');

    // Reselecting the current organization must not discard its location scope.
    if (await selectedOrganizationId(session) === authorized) return success(authorized, false);
    const audited = await recordPlatformAccess(session, {
      action: 'workspace.organization.select',
      brandId: authorized,
      locationId: null,
    });
    if (!audited) return failure(SWITCH_ERROR);
    const store = await cookies();
    store.set(ORG_COOKIE, authorized, workspaceCookieOptions());
    store.set(LOCATION_COOKIE, '', expiredWorkspaceCookieOptions());
    revalidatePath('/', 'layout');
    return success(authorized, true);
  } catch {
    return failure(SWITCH_ERROR);
  }
}

export async function selectLocation(
  _previous: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  try {
    const session = await currentSession();
    if (!session) return failure(SESSION_ERROR);
    const store = await cookies();
    const orgId = await selectedOrganizationId(session);
    const posted = String(formData.get('locationId') ?? '');
    const current = store.get(LOCATION_COOKIE)?.value ?? '';
    if (posted === '') {
      if (current === '') return success('', false);
      const audited = await recordPlatformAccess(session, {
        action: 'workspace.location.select', brandId: orgId, locationId: null,
      });
      if (!audited) return failure(SWITCH_ERROR);
      store.set(LOCATION_COOKIE, '', expiredWorkspaceCookieOptions());
      revalidatePath('/', 'layout');
      return success('', true);
    }
    if (!isWorkspaceCookieValue(posted) || !isWorkspaceCookieValue(orgId)) {
      return failure('Choose a valid location.');
    }
    const authorized = await authorizeLocation(session, orgId, posted);
    if (!authorized) return failure('That location is no longer available.');
    if (current === authorized) return success(authorized, false);
    const audited = await recordPlatformAccess(session, {
      action: 'workspace.location.select', brandId: orgId, locationId: authorized,
    });
    if (!audited) return failure(SWITCH_ERROR);
    store.set(LOCATION_COOKIE, authorized, workspaceCookieOptions());
    revalidatePath('/', 'layout');
    return success(authorized, true);
  } catch {
    return failure(SWITCH_ERROR);
  }
}
