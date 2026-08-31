import 'server-only';

/**
 * The location the operator has scoped the console to, read from the same
 * cookie the header switcher writes. Data loaders pass this into their queries
 * so the numbers follow the switcher. It is not re-authorized here: RLS keeps
 * every read inside the signed-in brand, so a stale or wrong location id can
 * only ever narrow to nothing, never widen across a tenant boundary.
 */
import { cookies } from 'next/headers';

import { isWorkspaceCookieValue, LOCATION_COOKIE } from './workspace-cookie';

export async function selectedLocationId(): Promise<string | null> {
  const value = (await cookies()).get(LOCATION_COOKIE)?.value;
  return isWorkspaceCookieValue(value) ? value : null;
}
