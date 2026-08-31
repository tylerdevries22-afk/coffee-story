'use server';

import { revalidatePath } from 'next/cache';

import { loadDeviceSigningKey } from '@platform/engine';
import type { TenantClaims } from '@platform/schema';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession } from '@/lib/auth';
import type { DeviceActionState } from '@/lib/device-action-state';
import {
  deviceAdminStatus, issueRefreshSecret, pairDevice, revokePairedDevice,
  type DeviceAdminDeps,
} from '@/lib/device-admin';
import {
  authorizeWorkspaceMutation, claimsForWorkspaceMutation,
} from '@/lib/workspace-mutation';

async function deviceContext(action: string, locationId: string): Promise<
  { deps: DeviceAdminDeps; claims: TenantClaims } | string
> {
  const env = serverEnv();
  if (!env) return 'This deployment is not connected to Supabase, so devices cannot be managed here.';
  const session = await currentSession();
  if (!session) return 'Your session has expired. Sign in again to manage devices.';
  const mutation = await authorizeWorkspaceMutation(session, { action, locationId });
  const claims = mutation ? claimsForWorkspaceMutation(session, mutation) : null;
  if (!claims) return 'Your session has expired. Sign in again to manage devices.';
  return { deps: { db: serviceDb(env), loadKey: loadDeviceSigningKey }, claims };
}

function failure(error: unknown): DeviceActionState {
  const answer = deviceAdminStatus(error);
  return answer
    ? { kind: 'error', message: answer.message }
    : { kind: 'error', message: 'That device action could not be completed.' };
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function pairDeviceAction(
  _previous: DeviceActionState, formData: FormData,
): Promise<DeviceActionState> {
  const locationId = text(formData, 'locationId');
  const context = await deviceContext('devices.pair_code.create', locationId);
  if (typeof context === 'string') return { kind: 'error', message: context };
  try {
    const invite = await pairDevice(context.deps, context.claims, {
      locationId, role: text(formData, 'role'), label: text(formData, 'label'),
    });
    revalidatePath('/locations');
    return { kind: 'paired', ...invite };
  } catch (error) { return failure(error); }
}

export async function issueRefreshSecretAction(
  _previous: DeviceActionState, formData: FormData,
): Promise<DeviceActionState> {
  const context = await deviceContext(
    'devices.refresh_secret.issue', text(formData, 'locationId'),
  );
  if (typeof context === 'string') return { kind: 'error', message: context };
  try {
    const issued = await issueRefreshSecret(context.deps, context.claims, text(formData, 'deviceId'));
    revalidatePath('/locations');
    return {
      kind: 'secret', deviceId: issued.deviceId, secret: issued.secret,
      previousExpiresAt: issued.previousExpiresAt ?? null,
    };
  } catch (error) { return failure(error); }
}

export async function revokeDeviceAction(
  _previous: DeviceActionState, formData: FormData,
): Promise<DeviceActionState> {
  const context = await deviceContext('devices.revoke', text(formData, 'locationId'));
  if (typeof context === 'string') return { kind: 'error', message: context };
  const deviceId = text(formData, 'deviceId');
  try {
    await revokePairedDevice(context.deps, context.claims, deviceId);
    revalidatePath('/locations');
    return { kind: 'revoked', deviceId };
  } catch (error) { return failure(error); }
}
