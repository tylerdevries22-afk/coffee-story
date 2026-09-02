import 'server-only';

import {
  connectionStateAt, type DeviceInstallationSummary, type DeviceWallLayoutItem,
  type DeviceWallPolicy,
} from '@platform/device-wall';

import { currentSession, hasRole, isConfigured } from './auth';
import { deviceWallPolicyFor, deviceWallStreamsEnabled } from './device-wall-policy';
import { serverClient } from './supabase-server';
import { tenantOrgById } from './tenants';
import { readWorkspaceScope, type WorkspaceLocation } from './workspace-scope';

export type WallInstallation = DeviceInstallationSummary & { readonly locationName: string };
export type DeviceWallView = {
  readonly brandId: string;
  readonly policy: DeviceWallPolicy;
  readonly locations: readonly WorkspaceLocation[];
  readonly selectedLocationId: string | null;
  readonly installations: readonly WallInstallation[];
  readonly layout: readonly DeviceWallLayoutItem[];
  readonly canManage: boolean;
  readonly canDiagnose: boolean;
  readonly canStream: boolean;
  readonly configured: boolean;
};

type InstallationRow = {
  id: string; brand_id: string; location_id: string; installed_by: string | null;
  label: string; form_factor: DeviceInstallationSummary['formFactor'];
  app_target: DeviceInstallationSummary['appTarget']; platform: DeviceInstallationSummary['platform'];
  app_version: string; runtime_version: string; capabilities: DeviceInstallationSummary['capabilities'];
  last_seen_at: string | null; archived_at: string | null;
};

function demoInstallations(brandId: string, locations: readonly WorkspaceLocation[], policy: DeviceWallPolicy) {
  const now = Date.now();
  const samples = [
    { id: '7a587a71-19e3-4df4-806b-546d8a3b7e25', label: 'Runner phone', formFactor: 'phone', appTarget: 'operator', age: 12 },
    { id: 'c52d6b92-876c-4f23-98ae-f9b057391181', label: 'Prep tablet', formFactor: 'tablet', appTarget: 'operator', age: 18 },
    { id: '130b64f2-47e0-44d0-9307-60ae39b556ac', label: 'Pickup board', formFactor: 'tv', appTarget: 'pickup_queue', age: 82 },
    { id: '9e058827-75ae-4c65-b5d7-af173085c77c', label: 'Lobby kiosk', formFactor: 'tablet', appTarget: 'kiosk_pos', age: 220 },
  ] as const;
  const fallback = locations[0] ?? { id: 'loc-downtown', name: 'Downtown', city: '' };
  return samples.map((sample, index): WallInstallation => {
    const location = locations[index % Math.max(locations.length, 1)] ?? fallback;
    const lastSeenAt = new Date(now - sample.age * 1_000).toISOString();
    return {
      id: sample.id, brandId, locationId: location.id, locationName: location.name,
      installedBy: null, label: sample.label, formFactor: sample.formFactor,
      appTarget: sample.appTarget, platform: index === 0 ? 'ios' : 'web',
      appVersion: '1.0.0', runtimeVersion: index === 0 ? 'exposdk-54.0.0' : 'web-1.0.0',
      capabilities: ['heartbeat', 'diagnostics', 'screen_capture', 'webrtc', 'turn'],
      lastSeenAt, archivedAt: null,
      connectionState: connectionStateAt({ lastSeenAt, archivedAt: null }, policy, now),
    };
  });
}

function mapRows(rows: readonly InstallationRow[], locations: readonly WorkspaceLocation[], policy: DeviceWallPolicy) {
  return rows.map((row): WallInstallation => ({
    id: row.id, brandId: row.brand_id, locationId: row.location_id,
    locationName: locations.find((location) => location.id === row.location_id)?.name ?? 'Location',
    installedBy: row.installed_by, label: row.label, formFactor: row.form_factor,
    appTarget: row.app_target, platform: row.platform, appVersion: row.app_version,
    runtimeVersion: row.runtime_version, capabilities: row.capabilities,
    lastSeenAt: row.last_seen_at, archivedAt: row.archived_at,
    connectionState: connectionStateAt({ lastSeenAt: row.last_seen_at, archivedAt: row.archived_at }, policy),
  }));
}

export async function loadDeviceWall(): Promise<DeviceWallView> {
  const session = await currentSession();
  if (!session) throw new Error('Sign in to view the device wall.');
  const workspace = await readWorkspaceScope(session);
  const brandId = workspace.organizationId ?? session.brandId;
  const configured = isConfigured();
  const client = configured ? await serverClient() : null;
  let slug: string | null = null;
  if (client) {
    const brand = await client.from('brands').select('slug').eq('id', brandId).maybeSingle<{ slug: string | null }>();
    slug = brand.data?.slug ?? null;
  } else {
    // Demo mode takes the policy of the org the console is switched to, from
    // the same registry that themes it, so no tenant slug is spelled out here.
    slug = tenantOrgById(workspace.organizationId ?? session.brandId)?.slug ?? null;
  }
  const policy = deviceWallPolicyFor(slug);
  let installations = demoInstallations(brandId, workspace.locations, policy);
  let layout: readonly DeviceWallLayoutItem[] = [];
  if (client && session.userId) {
    let layoutQuery = client.from('device_wall_layouts').select('layout')
      .eq('brand_id', brandId).eq('user_id', session.userId);
    layoutQuery = workspace.locationId
      ? layoutQuery.eq('location_id', workspace.locationId)
      : layoutQuery.is('location_id', null);
    const [rows, savedLayout] = await Promise.all([
      client.from('device_installations').select('id, brand_id, location_id, installed_by, label, form_factor, app_target, platform, app_version, runtime_version, capabilities, last_seen_at, archived_at')
        .eq('brand_id', brandId).is('revoked_at', null).returns<InstallationRow[]>(),
      layoutQuery.maybeSingle<{ layout: DeviceWallLayoutItem[] }>(),
    ]);
    if (rows.error) throw new Error('The device wall could not be loaded.');
    installations = mapRows(rows.data ?? [], workspace.locations, policy);
    layout = savedLayout.data?.layout ?? [];
  }
  const canManage = hasRole(session, 'brand_owner');
  return {
    brandId, policy, locations: workspace.locations, selectedLocationId: workspace.locationId,
    installations, layout, canManage, canDiagnose: canManage,
    canStream: canManage && deviceWallStreamsEnabled(policy), configured,
  };
}
