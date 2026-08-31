import 'server-only';

import { cookies } from 'next/headers';

import { currentSession } from './auth';
import { isWorkspaceCookieValue, LOCATION_COOKIE, ORG_COOKIE } from './workspace-cookie';
import { readWorkspaceScope } from './workspace-scope';

/** Raw cookie scope for demo-only fixtures. Live reads must use the authorized
 * helpers below so stale or foreign values never reach UUID query filters. */
export async function selectedLocationId(): Promise<string | null> {
  const value = (await cookies()).get(LOCATION_COOKIE)?.value;
  return isWorkspaceCookieValue(value) ? value : null;
}

/** The organization the operator has selected, or null to fall back to their
 *  home org. Shape-checked only; callers that write re-authorize it. */
export async function selectedOrgId(): Promise<string | null> {
  const value = (await cookies()).get(ORG_COOKIE)?.value;
  return isWorkspaceCookieValue(value) ? value : null;
}

/** The selected location after checking it against the selected org's stores. */
export async function authorizedSelectedLocationId(): Promise<string | null> {
  const session = await currentSession();
  if (!session) return null;
  return (await readWorkspaceScope(session)).locationId;
}

/** Human-readable scope for reports that follow the location switcher. */
export async function selectedLocationLabel(): Promise<string> {
  const session = await currentSession();
  if (!session) return 'All locations';
  const scope = await readWorkspaceScope(session);
  return scope.locations.find((location) => location.id === scope.locationId)?.name
    ?? 'All locations';
}
