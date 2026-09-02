import { createHash } from 'node:crypto';

import {
  DeviceEnrollmentError, mayCreateEnrollment, pairedDeviceRole, parseDeviceEnrollment,
} from '@platform/device-wall';
import {
  hashPairingCode, issuePairingCode, loadDeviceSigningKey, revokeDevice,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthedRequest } from './api-auth';
import { DeviceWallServiceError } from './device-wall-registration';
import { deviceWallPolicyFor } from './device-wall-policy';

function brandFor(auth: AuthedRequest, requested: string | null): string {
  if (auth.claims.role === 'platform_admin') return requested ?? auth.claims.brand_id;
  if (requested && requested !== auth.claims.brand_id) {
    throw new DeviceWallServiceError(403, 'forbidden', 'That tenant is not available.');
  }
  return auth.claims.brand_id;
}

export async function createDeviceEnrollment(
  db: SupabaseClient,
  auth: AuthedRequest,
  value: unknown,
) {
  if (!auth.claims.role || !mayCreateEnrollment(auth.claims.role)) {
    throw new DeviceWallServiceError(403, 'forbidden', 'Only an owner can enroll a device.');
  }
  let input;
  try { input = parseDeviceEnrollment(value); }
  catch (error) {
    if (error instanceof DeviceEnrollmentError) {
      throw new DeviceWallServiceError(400, 'invalid_enrollment', error.message);
    }
    throw error;
  }
  if (input.appTarget === 'operator') {
    throw new DeviceWallServiceError(409, 'automatic_registration', 'Operator registers after authenticated startup.');
  }
  const brandId = brandFor(auth, input.brandId);
  const [location, brand] = await Promise.all([
    db.from('locations').select('id').eq('id', input.locationId).eq('brand_id', brandId).maybeSingle<{ id: string }>(),
    db.from('brands').select('slug').eq('id', brandId).maybeSingle<{ slug: string | null }>(),
  ]);
  if (location.error || brand.error) {
    throw new DeviceWallServiceError(400, 'enrollment_failed', 'The enrollment scope could not be verified.');
  }
  if (!location.data || !brand.data) {
    throw new DeviceWallServiceError(403, 'forbidden', 'That location is not available.');
  }
  const policy = deviceWallPolicyFor(brand.data.slug);
  if (!policy.enabled || !policy.appTargets.includes(input.appTarget)
      || !policy.formFactors.includes(input.formFactor)) {
    throw new DeviceWallServiceError(403, 'module_disabled', 'That device type is not enabled for this tenant.');
  }
  const key = loadDeviceSigningKey();
  const invite = await issuePairingCode({ db, key }, {
    brandId, locationId: input.locationId,
    role: pairedDeviceRole(input.appTarget), label: input.label,
  });
  const fingerprint = createHash('sha256').update(`pending-device:${invite.deviceId}`).digest('hex');
  const installation = await db.from('device_installations').insert({
    id: invite.deviceId, brand_id: brandId, location_id: input.locationId,
    paired_device_id: invite.deviceId, installed_by: null, label: input.label,
    form_factor: input.formFactor, app_target: input.appTarget, platform: 'web',
    app_version: 'pending', runtime_version: 'pending', capabilities: ['heartbeat'],
    identity_fingerprint: fingerprint,
  });
  if (installation.error) {
    await revokeDevice({ db, key }, { brandId, deviceId: invite.deviceId });
    throw new DeviceWallServiceError(400, 'enrollment_failed', 'The installation could not be created.');
  }
  const enrollment = await db.from('device_wall_enrollment_codes').insert({
    installation_id: invite.deviceId, paired_device_id: invite.deviceId,
    brand_id: brandId, location_id: input.locationId,
    code_hash: hashPairingCode(invite.code, key), created_by: auth.userId,
    expires_at: invite.expiresAt,
  });
  if (enrollment.error) {
    await db.from('device_installations').delete().eq('id', invite.deviceId).eq('brand_id', brandId);
    await revokeDevice({ db, key }, { brandId, deviceId: invite.deviceId });
    throw new DeviceWallServiceError(400, 'enrollment_failed', 'The enrollment could not be created.');
  }
  return { installationId: invite.deviceId, code: invite.code, expiresAt: invite.expiresAt };
}
