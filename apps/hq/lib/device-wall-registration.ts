import { createHash } from 'node:crypto';

import {
  DeviceEnrollmentError, pairedDeviceRole, parseDeviceRegistration,
  type DeviceRegistrationInput,
} from '@platform/device-wall';
import { canManageLocation } from '@platform/schema';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Caller } from './api-auth';

export class DeviceWallServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceWallServiceError';
  }
}

function publicIdentity(input: DeviceRegistrationInput) {
  if (!input.publicKey) {
    throw new DeviceWallServiceError(400, 'public_key_required', 'A non-exportable device identity is required.');
  }
  let key: unknown;
  try { key = JSON.parse(input.publicKey); }
  catch { throw new DeviceWallServiceError(400, 'invalid_public_key', 'The public device identity is invalid.'); }
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    throw new DeviceWallServiceError(400, 'invalid_public_key', 'The public device identity is invalid.');
  }
  const fields = key as Record<string, unknown>;
  const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const base64url = /^[A-Za-z0-9_-]{40,96}$/;
  const rsa = fields.kty === 'RSA' && fields.alg === 'RS256' && fields.use === 'sig'
    && typeof fields.spki === 'string' && fields.spki.length <= 2048 && base64.test(fields.spki);
  const ec = fields.kty === 'EC' && fields.crv === 'P-256'
    && typeof fields.x === 'string' && base64url.test(fields.x)
    && typeof fields.y === 'string' && base64url.test(fields.y);
  if (!rsa && !ec) {
    throw new DeviceWallServiceError(400, 'invalid_public_key', 'The public device identity is invalid.');
  }
  return {
    fingerprint: createHash('sha256').update(input.publicKey).digest('hex'),
    jwk: key,
  };
}

async function locationExists(db: SupabaseClient, brandId: string, locationId: string) {
  const location = await db.from('locations').select('id')
    .eq('id', locationId).eq('brand_id', brandId).maybeSingle<{ id: string }>();
  if (location.error) throw new DeviceWallServiceError(400, 'registration_failed', 'The location could not be verified.');
  if (!location.data) throw new DeviceWallServiceError(403, 'forbidden', 'That location is not available.');
}

function callerScope(caller: Caller, input: DeviceRegistrationInput) {
  if (caller.kind === 'device') {
    if (input.installationId !== caller.device.id || input.locationId !== caller.claims.locationId) {
      throw new DeviceWallServiceError(403, 'forbidden', 'This device cannot register another installation.');
    }
    if (pairedDeviceRole(input.appTarget) !== caller.claims.role) {
      throw new DeviceWallServiceError(403, 'forbidden', 'The paired application target does not match.');
    }
    return { brandId: caller.claims.brandId, installedBy: null, pairedDeviceId: caller.device.id };
  }
  if (!caller.claims.role || input.appTarget !== 'operator' || !canManageLocation(caller.claims, input.locationId)) {
    throw new DeviceWallServiceError(403, 'forbidden', 'This account cannot register that installation.');
  }
  return { brandId: caller.claims.brand_id, installedBy: caller.userId, pairedDeviceId: null };
}

export async function registerInstallation(db: SupabaseClient, caller: Caller, value: unknown) {
  let input: DeviceRegistrationInput;
  try { input = parseDeviceRegistration(value); }
  catch (error) {
    if (error instanceof DeviceEnrollmentError) {
      throw new DeviceWallServiceError(400, 'invalid_registration', error.message);
    }
    throw error;
  }
  const scope = callerScope(caller, input);
  await locationExists(db, scope.brandId, input.locationId);
  const identity = publicIdentity(input);
  const byId = await db.from('device_installations')
    .select('id, installed_by, paired_device_id').eq('brand_id', scope.brandId)
    .eq('id', input.installationId)
    .maybeSingle<{ id: string; installed_by: string | null; paired_device_id: string | null }>();
  if (byId.error) throw new DeviceWallServiceError(400, 'registration_failed', 'The installation could not be checked.');
  let existing = byId.data;
  if (!existing && caller.kind === 'user') {
    const byFingerprint = await db.from('device_installations')
      .select('id, installed_by, paired_device_id').eq('brand_id', scope.brandId)
      .eq('identity_fingerprint', identity.fingerprint)
      .maybeSingle<{ id: string; installed_by: string | null; paired_device_id: string | null }>();
    if (byFingerprint.error) {
      throw new DeviceWallServiceError(400, 'registration_failed', 'The installation could not be checked.');
    }
    existing = byFingerprint.data;
  }
  if (caller.kind === 'device' && existing?.paired_device_id !== caller.device.id) {
    throw new DeviceWallServiceError(403, 'forbidden', 'This device cannot replace another installation.');
  }
  if (existing && existing.installed_by !== scope.installedBy) {
    throw new DeviceWallServiceError(409, 'identity_in_use', 'That installation identity is already registered.');
  }
  const id = existing?.id ?? input.installationId;
  const row = {
    id, brand_id: scope.brandId, location_id: input.locationId,
    paired_device_id: scope.pairedDeviceId, installed_by: scope.installedBy,
    label: input.label, form_factor: input.formFactor, app_target: input.appTarget,
    platform: input.platform, app_version: input.appVersion, runtime_version: input.runtimeVersion,
    capabilities: input.capabilities, identity_fingerprint: identity.fingerprint,
    public_key_jwk: identity.jwk, last_seen_at: new Date().toISOString(),
  };
  const saved = existing
    ? await db.from('device_installations').update(row).eq('id', id).select('id').single<{ id: string }>()
    : await db.from('device_installations').insert(row).select('id').single<{ id: string }>();
  if (saved.error) throw new DeviceWallServiceError(400, 'registration_failed', 'The installation could not be registered.');
  return { installationId: saved.data.id };
}
