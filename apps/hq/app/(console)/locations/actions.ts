'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { disconnectSquare } from '@/lib/square-admin';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import { parseLocationDraft } from '@/lib/location-input';
import { locationCreationContinuation } from '@/lib/location-onboarding';
import { addDemoLocation } from '@/lib/demo-locations';
import {
  authorizeWorkspaceMutation, claimsForWorkspaceMutation,
} from '@/lib/workspace-mutation';
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Create a new location for the selected organization.
 *
 * A brand_owner (or platform_admin) writes it as themselves -- `locations_write`
 * already admits `is_brand_owner(brand_id)`, so no service role is involved and
 * RLS is the authority. The org is the one the header has selected, re-verified
 * against the session's authorized set so a posted org id can never place a
 * store under a brand the caller may not write. The row starts blank: only the
 * name, address, hours, and timezone the operator typed -- no inherited copy.
 * In the demo it lands in the in-memory store so the flow is fully clickable
 * with no database.
 */
export async function createLocationAction(formData: FormData): Promise<void> {
  const session = await currentSession();
  if (!session || !hasRole(session, 'brand_owner')) redirect('/locations?created=denied');

  const parsed = parseLocationDraft({
    name: text(formData, 'name'),
    street: text(formData, 'street'),
    city: text(formData, 'city'),
    region: text(formData, 'region'),
    postal: text(formData, 'postal'),
    timezone: text(formData, 'timezone'),
    openTime: text(formData, 'openTime'),
    closeTime: text(formData, 'closeTime'),
    days: formData.getAll('days').map(String),
  });
  if (!parsed.ok) redirect(`/locations/new?error=${encodeURIComponent(parsed.error)}`);
  const draft = parsed.draft;

  const mutation = await authorizeWorkspaceMutation(session, { action: 'locations.create' });
  if (!mutation) redirect('/locations?created=denied');
  const orgId = mutation.brandId;

  if (!isConfigured()) {
    const locationId = `loc-${crypto.randomUUID()}`.slice(0, 60);
    addDemoLocation(orgId, {
      id: locationId,
      name: draft.name,
      city: draft.city,
      timezone: draft.timezone,
      squareConnected: false,
      orderingPaused: false,
      hours: draft.hoursSummary,
    });
    revalidatePath('/locations');
    revalidatePath('/', 'layout');
    redirect(locationCreationContinuation({
      locationId,
      homeOrganizationId: session.brandId,
      selectedOrganizationId: orgId,
      connectSquare: false,
    }).href);
  }

  const client = await serverClient();
  if (!client) redirect('/locations?created=failed');
  const insert = await client.rpc('create_location_if_allowed', {
    target_brand_id: orgId,
    location_name: draft.name,
    location_address: draft.address,
    location_hours: draft.hours,
    location_timezone: draft.timezone,
  });
  if (insert.error?.message.includes('single_location_limit_reached')) {
    redirect('/locations?created=limit');
  }
  const locationId = typeof insert.data === 'string' ? insert.data : null;
  if (insert.error || !locationId) {
    redirect(`/locations/new?error=${encodeURIComponent('Could not create the location.')}`);
  }
  revalidatePath('/locations');
  revalidatePath('/', 'layout');
  const continuation = locationCreationContinuation({
    locationId,
    homeOrganizationId: session.brandId,
    selectedOrganizationId: orgId,
    connectSquare: formData.get('connectSquare') === 'on',
  });
  redirect(continuation.href);
}

/**
 * Disconnect Square for one location.
 *
 * Answers on the same query-parameter channel the OAuth callback already
 * redirects back on, so the page has one place that turns an outcome into a
 * sentence (`squareConnectNotice`) instead of two. Nothing secret travels on
 * it -- only which of three sentences to show.
 */
export async function disconnectSquareAction(formData: FormData): Promise<void> {
  const env = serverEnv();
  const session = env ? await currentSession() : null;
  const locationId = text(formData, 'locationId');
  const mutation = session
    ? await authorizeWorkspaceMutation(session, { action: 'square.disconnect', locationId })
    : null;
  const claims = session && mutation ? claimsForWorkspaceMutation(session, mutation) : null;
  let outcome = 'failed';
  if (env && claims) {
    try {
      outcome = (await disconnectSquare(serviceDb(env), claims, locationId)).outcome;
    } catch {
      // Refused, or not connected: both leave the connection exactly as it
      // was, which is what "nothing was changed" means. An end state that
      // changed something is returned rather than thrown.
      outcome = 'failed';
    }
  }
  revalidatePath('/locations');
  // Outside the try: redirect signals by throwing.
  redirect(`/locations?disconnect=${outcome}`);
}
