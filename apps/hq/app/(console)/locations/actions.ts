'use server';

import { revalidatePath } from 'next/cache';

import { loadDeviceSigningKey } from '@platform/engine';

import { currentClaims } from '@/lib/auth';
import type { DeviceActionState } from '@/lib/device-action-state';
import { serverEnv, serviceDb } from '@/lib/api-auth';
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
