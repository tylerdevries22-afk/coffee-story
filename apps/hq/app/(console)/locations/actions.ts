'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { loadDeviceSigningKey } from '@platform/engine';

import { currentClaims, currentSession, hasRole } from '@/lib/auth';
import { disconnectSquare } from '@/lib/square-admin';
import type { DeviceActionState } from '@/lib/device-action-state';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import { parseLocationDraft } from '@/lib/location-input';
import { locationCreationContinuation } from '@/lib/location-onboarding';
import { addDemoLocation } from '@/lib/demo-locations';
import { selectedOrgId } from '@/lib/workspace-location';
import { authorizeOrganization } from '@/lib/workspace-scope';
import {
  deviceAdminStatus, issueRefreshSecret, pairDevice, revokePairedDevice,
  type DeviceAdminDeps,
} from '@/lib/device-admin';

/**
 * Device writes run as the service role, and that is not a shortcut.
 *
 * `app.protect_device_lifecycle` refuses any caller carrying a jwt_role that
 * touches pairing or refresh-secret columns, precisely so a location_manager
 * cannot plant a hash whose preimage they chose. The signed-in user's client
 * therefore cannot perform these writes at all; authorization is decided in
 * lib/device-admin against the caller's own claims, and only then is the write
 * handed to a client that RLS does not apply to.
 */
async function deviceContext(): Promise<
  { deps: DeviceAdminDeps; claims: NonNullable<Awaited<ReturnType<typeof currentClaims>>> } | string
> {
  const env = serverEnv();
  if (!env) return 'This deployment is not connected to Supabase, so devices cannot be managed here.';
  const claims = await currentClaims();
  if (!claims) return 'Your session has expired. Sign in again to manage devices.';
  return { deps: { db: serviceDb(env), loadKey: loadDeviceSigningKey }, claims };
}

/** Turns any failure into a sentence an operator can act on, never a stack trace. */
function failure(error: unknown): DeviceActionState {
  const answer = deviceAdminStatus(error);
  if (answer) return { kind: 'error', message: answer.message };
  return { kind: 'error', message: 'That device action could not be completed.' };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function pairDeviceAction(
  _previous: DeviceActionState, formData: FormData,
): Promise<DeviceActionState> {
  const context = await deviceContext();
  if (typeof context === 'string') return { kind: 'error', message: context };
  try {
    const invite = await pairDevice(context.deps, context.claims, {
      locationId: text(formData, 'locationId'),
      role: text(formData, 'role'),
      label: text(formData, 'label'),
    });
    revalidatePath('/locations');
    return { kind: 'paired', deviceId: invite.deviceId, code: invite.code, expiresAt: invite.expiresAt };
  } catch (error) {
    return failure(error);
  }
}

export async function issueRefreshSecretAction(
  _previous: DeviceActionState, formData: FormData,
): Promise<DeviceActionState> {
  const context = await deviceContext();
  if (typeof context === 'string') return { kind: 'error', message: context };
  try {
    const issued = await issueRefreshSecret(context.deps, context.claims, text(formData, 'deviceId'));
    revalidatePath('/locations');
    return {
      kind: 'secret',
      deviceId: issued.deviceId,
      secret: issued.secret,
      previousExpiresAt: issued.previousExpiresAt ?? null,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeDeviceAction(
  _previous: DeviceActionState, formData: FormData,
): Promise<DeviceActionState> {
  const context = await deviceContext();
  if (typeof context === 'string') return { kind: 'error', message: context };
  const deviceId = text(formData, 'deviceId');
  try {
    await revokePairedDevice(context.deps, context.claims, deviceId);
    revalidatePath('/locations');
    return { kind: 'revoked', deviceId };
  } catch (error) {
    return failure(error);
  }
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

  const cookieOrg = await selectedOrgId();
  const orgId = (cookieOrg ? await authorizeOrganization(session, cookieOrg) : null) ?? session.brandId;

  if (!isConfigured()) {
    addDemoLocation(orgId, {
      id: `loc-${crypto.randomUUID()}`.slice(0, 60),
      name: draft.name,
      city: draft.city,
      timezone: draft.timezone,
      squareConnected: false,
      orderingPaused: false,
      hours: draft.hoursSummary,
    });
    revalidatePath('/locations');
    revalidatePath('/', 'layout');
    redirect('/locations?created=1');
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
  if (continuation.kind === 'connect') redirect(continuation.href);
  redirect(`/locations?created=${continuation.notice}`);
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
  const claims = env ? await currentClaims() : null;
  let outcome = 'failed';
  if (env && claims) {
    try {
      outcome = (await disconnectSquare(serviceDb(env), claims, text(formData, 'locationId'))).outcome;
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
