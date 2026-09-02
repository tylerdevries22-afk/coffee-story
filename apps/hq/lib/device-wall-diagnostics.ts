import { diagnosticPlan, type DeviceCapability, type DiagnosticResult } from '@platform/device-wall';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthedRequest } from './api-auth';
import { DeviceWallServiceError } from './device-wall-registration';

type Installation = {
  id: string;
  brand_id: string;
  location_id: string;
  capabilities: DeviceCapability[];
  last_seen_at: string | null;
  runtime_version: string;
  revoked_at: string | null;
};

function scopedBrand(auth: AuthedRequest, requested: unknown): string {
  if (auth.claims.role === 'platform_admin' && typeof requested === 'string') return requested;
  return auth.claims.brand_id;
}

function serverResult(row: Installation, key: DiagnosticResult['key']): DiagnosticResult {
  if (key === 'authentication') {
    return { key, status: row.revoked_at ? 'fail' : 'pass', durationMs: null, safeMessage: row.revoked_at ? 'Revoked' : 'Identity active' };
  }
  if (key === 'runtime') {
    const sdk54 = row.runtime_version.startsWith('exposdk-54') || row.runtime_version === 'pending';
    return { key, status: sdk54 ? 'pass' : 'warning', durationMs: null, safeMessage: sdk54 ? 'Runtime compatible' : 'Review runtime version' };
  }
  if (key === 'heartbeat') {
    const latency = row.last_seen_at ? Date.now() - Date.parse(row.last_seen_at) : Number.POSITIVE_INFINITY;
    const status = latency <= 75_000 ? 'pass' : latency <= 180_000 ? 'warning' : 'fail';
    return { key, status, durationMs: Number.isFinite(latency) ? latency : null, safeMessage: status === 'pass' ? 'Heartbeat current' : 'Heartbeat delayed' };
  }
  return { key, status: 'not_available', durationMs: null, safeMessage: 'Awaiting device confirmation' };
}

export async function runSafeDiagnostics(
  db: SupabaseClient,
  auth: AuthedRequest,
  value: { installationId?: unknown; brandId?: unknown },
) {
  if (auth.claims.role !== 'brand_owner' && auth.claims.role !== 'platform_admin') {
    throw new DeviceWallServiceError(403, 'forbidden', 'Only an owner can run diagnostics.');
  }
  if (typeof value.installationId !== 'string') {
    throw new DeviceWallServiceError(400, 'invalid_request', 'installationId is required.');
  }
  const brandId = scopedBrand(auth, value.brandId);
  const found = await db.from('device_installations')
    .select('id, brand_id, location_id, capabilities, last_seen_at, runtime_version, revoked_at')
    .eq('id', value.installationId).eq('brand_id', brandId).maybeSingle<Installation>();
  if (found.error || !found.data) {
    throw new DeviceWallServiceError(404, 'installation_unavailable', 'That installation is unavailable.');
  }
  const installation = found.data;
  const results = diagnosticPlan(installation.capabilities).map((check) => serverResult(installation, check.key));
  const saved = await db.from('device_diagnostic_runs').insert({
    installation_id: installation.id, brand_id: installation.brand_id,
    location_id: installation.location_id, requested_by: auth.userId, results,
  }).select('id, created_at').single<{ id: string; created_at: string }>();
  if (saved.error) throw new DeviceWallServiceError(400, 'diagnostics_failed', 'Diagnostics could not be recorded.');
  return { id: saved.data.id, createdAt: saved.data.created_at, results };
}
