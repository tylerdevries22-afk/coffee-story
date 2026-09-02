import { canRequestScreenView, connectionStateAt, type DeviceCapability } from '@platform/device-wall';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthedRequest } from './api-auth';
import { generateTurnCredentials } from './cloudflare-turn';
import { deviceWallPolicyFor, deviceWallStreamsEnabled } from './device-wall-policy';
import { DeviceWallServiceError } from './device-wall-registration';

type StreamRow = {
  id: string;
  installation_id: string;
  state: string;
  created_at: string;
  expires_at: string;
};

type InstallationRow = {
  id: string;
  location_id: string;
  capabilities: DeviceCapability[];
  last_seen_at: string | null;
};

function brandFor(auth: AuthedRequest, requested: unknown): string {
  if (auth.claims.role === 'platform_admin' && typeof requested === 'string') return requested;
  return auth.claims.brand_id;
}

export async function authorizeDeviceStream(
  db: SupabaseClient,
  auth: AuthedRequest,
  value: { installationId?: unknown; brandId?: unknown },
) {
  if (auth.claims.role !== 'brand_owner' && auth.claims.role !== 'platform_admin') {
    throw new DeviceWallServiceError(403, 'forbidden', 'Only an owner can view a device screen.');
  }
  if (typeof value.installationId !== 'string') {
    throw new DeviceWallServiceError(400, 'invalid_request', 'installationId is required.');
  }
  const brandId = brandFor(auth, value.brandId);
  const [brand, installation] = await Promise.all([
    db.from('brands').select('slug').eq('id', brandId).maybeSingle<{ slug: string | null }>(),
    db.from('device_installations').select('id, location_id, capabilities, last_seen_at')
      .eq('id', value.installationId).eq('brand_id', brandId)
      .is('archived_at', null).is('revoked_at', null)
      .maybeSingle<InstallationRow>(),
  ]);
  if (brand.error || installation.error || !brand.data || !installation.data) {
    throw new DeviceWallServiceError(404, 'installation_unavailable', 'That installation is unavailable.');
  }
  const policy = deviceWallPolicyFor(brand.data.slug);
  if (!deviceWallStreamsEnabled(policy)) {
    throw new DeviceWallServiceError(403, 'streaming_disabled', 'Screen viewing is not enabled for this tenant rollout.');
  }
  if (!canRequestScreenView(installation.data)) {
    throw new DeviceWallServiceError(409, 'stream_unsupported', 'This installation cannot share a screen yet.');
  }
  const state = connectionStateAt({ lastSeenAt: installation.data.last_seen_at, archivedAt: null }, policy);
  if (state !== 'online') {
    throw new DeviceWallServiceError(409, 'device_not_ready', 'This device needs a current heartbeat before it can connect.');
  }
  const created = await db.rpc('create_device_stream_session', {
    p_installation_id: installation.data.id, p_brand_id: brandId,
    p_location_id: installation.data.location_id, p_viewer_id: auth.userId,
    p_max_streams: policy.limits.maxConcurrentStreams,
  }).single<StreamRow>();
  if (created.error || !created.data) {
    const limit = created.error?.message.includes('limit') ? 'stream_limit_reached' : 'stream_unavailable';
    throw new DeviceWallServiceError(409, limit, 'A secure stream could not be started.');
  }
  try {
    const iceServers = await generateTurnCredentials(created.data.id);
    return {
      session: {
        id: created.data.id, installationId: created.data.installation_id,
        viewerId: auth.userId, state: created.data.state,
        createdAt: created.data.created_at, expiresAt: created.data.expires_at,
      },
      channel: `device-wall:${installation.data.id}`,
      iceServers,
      consentRequired: true,
    };
  } catch (error) {
    await db.from('device_stream_sessions').update({ state: 'ended', ended_at: new Date().toISOString() })
      .eq('id', created.data.id).eq('viewer_id', auth.userId);
    await db.from('device_stream_audit_events').insert({
      session_id: created.data.id, installation_id: installation.data.id,
      brand_id: brandId, location_id: installation.data.location_id,
      viewer_id: auth.userId, event: 'failed', reason_code: 'turn_unavailable',
    });
    throw error;
  }
}

export async function endDeviceStream(db: SupabaseClient, auth: AuthedRequest, sessionId: string) {
  const session = await db.from('device_stream_sessions').select('id, installation_id, brand_id, location_id')
    .eq('id', sessionId).eq('viewer_id', auth.userId).is('ended_at', null)
    .maybeSingle<{ id: string; installation_id: string; brand_id: string; location_id: string }>();
  if (session.error || !session.data) {
    throw new DeviceWallServiceError(404, 'stream_unavailable', 'That stream is unavailable.');
  }
  const endedAt = new Date().toISOString();
  await db.from('device_stream_sessions').update({ state: 'ended', ended_at: endedAt }).eq('id', sessionId);
  await db.from('device_stream_audit_events').insert({
    session_id: sessionId, installation_id: session.data.installation_id,
    brand_id: session.data.brand_id, location_id: session.data.location_id,
    viewer_id: auth.userId, event: 'ended',
  });
  return { endedAt };
}
