'use server';

/**
 * Selecting an organization or location. Each is a plain server action so the
 * switcher works with no client JS: a menu row is a submit button that posts
 * its own id. The action re-establishes the session, re-authorizes the posted
 * id against the real set (never trusting the form), writes the cookie, and
 * revalidates the layout so the whole console re-themes and re-scopes.
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { currentSession } from '@/lib/auth';
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

export async function selectOrganization(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) return;
  const posted = String(formData.get('orgId') ?? '');
  if (!isWorkspaceCookieValue(posted)) return;
  const authorized = await authorizeOrganization(session, posted);
  if (!authorized) return;
  const store = await cookies();
  store.set(ORG_COOKIE, authorized, workspaceCookieOptions());
  // A location id only means something inside its owning org, so switching org
  // drops the remembered location rather than carrying a now-foreign one.
  store.set(LOCATION_COOKIE, '', expiredWorkspaceCookieOptions());
  revalidatePath('/', 'layout');
}

export async function selectLocation(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session) return;
  const store = await cookies();
  // Re-authorize the remembered org exactly as the layout does. A stale
  // cookie from an earlier session must not poison an otherwise valid choice.
  const orgId = await selectedOrganizationId(session);
  const posted = String(formData.get('locationId') ?? '');
  // The empty value is the "All locations" row -- a valid choice that clears
  // the scope rather than selecting one store.
  if (posted === '') {
    store.set(LOCATION_COOKIE, '', expiredWorkspaceCookieOptions());
    revalidatePath('/', 'layout');
    return;
  }
  if (!isWorkspaceCookieValue(posted) || !isWorkspaceCookieValue(orgId)) return;
  const authorized = await authorizeLocation(session, orgId, posted);
  if (!authorized) return;
  store.set(LOCATION_COOKIE, authorized, workspaceCookieOptions());
  revalidatePath('/', 'layout');
}
