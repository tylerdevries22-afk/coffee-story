'use server';

import { revalidatePath } from 'next/cache';

import { DeviceWallLayoutError, parseDeviceWallLayout } from '@platform/device-wall';

import { currentClaims, currentSession, isConfigured } from './auth';
import { serverEnv, serviceDb, type AuthedRequest } from './api-auth';
import { runSafeDiagnostics } from './device-wall-diagnostics';
import { createDeviceEnrollment } from './device-wall-enrollment';
import { DeviceWallServiceError } from './device-wall-registration';
import { authorizeDeviceStream } from './device-wall-streams';
import { serverClient } from './supabase-server';
import { readWorkspaceScope } from './workspace-scope';

export type DeviceWallActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function actionContext() {
  const [session, claims] = await Promise.all([currentSession(), currentClaims()]);
  const env = serverEnv();
  if (!session?.userId || !claims || !env) return null;
  const workspace = await readWorkspaceScope(session);
  const auth: AuthedRequest = { userId: session.userId, email: session.email, claims };
  return { auth, brandId: workspace.organizationId ?? claims.brand_id, db: serviceDb(env), workspace };
}

function failed(error: unknown): DeviceWallActionResult<never> {
  return { ok: false, error: error instanceof DeviceWallServiceError ? error.message : 'The request could not be completed.' };
}

export async function enrollDeviceAction(input: {
  locationId: string; label: string; formFactor: string; appTarget: string;
}): Promise<DeviceWallActionResult<{ installationId: string; code: string; expiresAt: string }>> {
  if (!isConfigured()) return { ok: true, data: { installationId: crypto.randomUUID(), code: 'PREVIEW8', expiresAt: new Date(Date.now() + 600_000).toISOString() } };
  const ctx = await actionContext();
  if (!ctx) return { ok: false, error: 'Sign in again before enrolling a device.' };
  try {
    const data = await createDeviceEnrollment(ctx.db, ctx.auth, { ...input, brandId: ctx.brandId });
    revalidatePath('/apps');
    return { ok: true, data };
  } catch (error) { return failed(error); }
}

export async function diagnosticsAction(installationId: string) {
  if (!isConfigured()) return { ok: true, data: { id: 'preview', createdAt: new Date().toISOString(), results: [] } } as const;
  const ctx = await actionContext();
  if (!ctx) return { ok: false, error: 'Sign in again before running diagnostics.' } as const;
  try { return { ok: true, data: await runSafeDiagnostics(ctx.db, ctx.auth, { installationId, brandId: ctx.brandId }) } as const; }
  catch (error) { return failed(error); }
}

export async function authorizeStreamAction(installationId: string) {
  const ctx = await actionContext();
  if (!ctx) return { ok: false, error: 'Streaming requires a configured production deployment.' } as const;
  try { return { ok: true, data: await authorizeDeviceStream(ctx.db, ctx.auth, { installationId, brandId: ctx.brandId }) } as const; }
  catch (error) { return failed(error); }
}

export async function revokeInstallationAction(installationId: string) {
  const ctx = await actionContext();
  if (!ctx) return { ok: false, error: 'Revocation requires a configured production deployment.' } as const;
  if (!ctx.auth.claims.role || !['platform_admin', 'brand_owner'].includes(ctx.auth.claims.role)) {
    return { ok: false, error: 'Only an owner can revoke an installation.' } as const;
  }
  const revoked = await ctx.db.rpc('revoke_device_installation', {
    p_installation_id: installationId, p_brand_id: ctx.brandId,
  });
  if (revoked.error) return { ok: false, error: 'That installation is unavailable.' } as const;
  revalidatePath('/apps');
  return { ok: true, data: { revoked: true } } as const;
}

export async function saveDeviceLayoutAction(locationId: string | null, value: unknown) {
  let layout;
  try { layout = parseDeviceWallLayout(value); }
  catch (error) {
    return { ok: false, error: error instanceof DeviceWallLayoutError ? error.message : 'The layout is invalid.' } as const;
  }
  if (!isConfigured()) return { ok: true, data: { saved: true } } as const;
  const session = await currentSession();
  if (!session?.userId) return { ok: false, error: 'Sign in again before saving the layout.' } as const;
  const workspace = await readWorkspaceScope(session);
  if (locationId && !workspace.locations.some((location) => location.id === locationId)) {
    return { ok: false, error: 'That location is not available.' } as const;
  }
  const client = await serverClient();
  if (!client || !workspace.organizationId) return { ok: false, error: 'The layout service is unavailable.' } as const;
  let existingQuery = client.from('device_wall_layouts').select('id')
    .eq('brand_id', workspace.organizationId).eq('user_id', session.userId);
  existingQuery = locationId
    ? existingQuery.eq('location_id', locationId)
    : existingQuery.is('location_id', null);
  const existing = await existingQuery.maybeSingle<{ id: string }>();
  const saved = existing.data
    ? await client.from('device_wall_layouts').update({ layout }).eq('id', existing.data.id)
    : await client.from('device_wall_layouts').insert({
      brand_id: workspace.organizationId, user_id: session.userId, location_id: locationId, layout,
    });
  return saved.error ? { ok: false, error: 'The layout could not be saved.' } : { ok: true, data: { saved: true } };
}
