import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuthedRequest } from './api-auth';
import {
  createDeviceEnrollment, createInstallationPairing,
} from './device-wall-enrollment';
import { DeviceWallServiceError } from './device-wall-registration';

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const LOCATION = '33333333-3333-4333-8333-333333333333';
const INSTALLATION = '44444444-4444-4444-8444-444444444444';

const owner: AuthedRequest = {
  userId: 'owner', email: 'owner@example.test',
  claims: { brand_id: BRAND, location_ids: [], role: 'brand_owner' },
};
const staff: AuthedRequest = {
  userId: 'staff', email: 'staff@example.test',
  claims: { brand_id: BRAND, location_ids: [LOCATION], role: 'staff' },
};

const enrollment = {
  brandId: null, locationId: LOCATION, label: 'Front counter',
  formFactor: 'tablet', appTarget: 'operator',
};

type ScopeResult = { data: unknown; error: unknown };

function scopeDb(results: Partial<Record<string, ScopeResult>>): SupabaseClient {
  return { from(table: string) {
    const query = {
      select() { return query; },
      eq() { return query; },
      maybeSingle: async () => results[table] ?? { data: null, error: null },
    };
    return query;
  } } as unknown as SupabaseClient;
}

function expectServiceError(status: number, code: string) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof DeviceWallServiceError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  };
}

describe('createDeviceEnrollment authorization and scope', () => {
  it('requires an owner and maps malformed input to a safe client error', async () => {
    await assert.rejects(createDeviceEnrollment(scopeDb({}), staff, enrollment),
      expectServiceError(403, 'forbidden'));
    await assert.rejects(createDeviceEnrollment(scopeDb({}), owner, { ...enrollment, locationId: 'bad' }),
      expectServiceError(400, 'invalid_enrollment'));
  });

  it('prevents a brand owner from selecting another tenant', async () => {
    await assert.rejects(createDeviceEnrollment(scopeDb({}), owner,
      { ...enrollment, brandId: OTHER_BRAND }), expectServiceError(403, 'forbidden'));
  });

  it('fails closed when tenant scope cannot be verified', async () => {
    await assert.rejects(createDeviceEnrollment(scopeDb({
      locations: { data: null, error: { code: 'database_error' } },
      brands: { data: { slug: 'coffee-story' }, error: null },
    }), owner, enrollment), expectServiceError(400, 'enrollment_failed'));

    await assert.rejects(createDeviceEnrollment(scopeDb({
      locations: { data: null, error: null },
      brands: { data: { slug: 'coffee-story' }, error: null },
    }), owner, enrollment), expectServiceError(403, 'forbidden'));
  });

  it('refuses device classes disabled by the tenant module policy', async () => {
    const admin: AuthedRequest = { ...owner,
      claims: { brand_id: BRAND, location_ids: [], role: 'platform_admin' } };
    await assert.rejects(createDeviceEnrollment(scopeDb({
      locations: { data: { id: LOCATION }, error: null },
      brands: { data: { slug: 'unconfigured-brand' }, error: null },
    }), admin, { ...enrollment, brandId: OTHER_BRAND }),
    expectServiceError(403, 'module_disabled'));
  });
});

const availableInstallation = {
  id: INSTALLATION, location_id: LOCATION, label: 'Pickup wall',
  app_target: 'pickup_queue', form_factor: 'tv', paired_device_id: null,
  archived_at: null, revoked_at: null,
};

describe('createInstallationPairing authorization and scope', () => {
  it('requires an owner, a valid installation id, and its own tenant', async () => {
    await assert.rejects(createInstallationPairing(scopeDb({}), staff,
      { installationId: INSTALLATION, brandId: null }), expectServiceError(403, 'forbidden'));
    await assert.rejects(createInstallationPairing(scopeDb({}), owner,
      { installationId: 'invalid', brandId: null }), expectServiceError(400, 'invalid_installation'));
    await assert.rejects(createInstallationPairing(scopeDb({}), owner,
      { installationId: INSTALLATION, brandId: OTHER_BRAND }), expectServiceError(403, 'forbidden'));
  });

  it('fails closed for lookup errors and unavailable installations', async () => {
    await assert.rejects(createInstallationPairing(scopeDb({
      device_installations: { data: null, error: { code: 'database_error' } },
      brands: { data: { slug: 'coffee-story' }, error: null },
    }), owner, { installationId: INSTALLATION, brandId: null }),
    expectServiceError(400, 'enrollment_failed'));

    await assert.rejects(createInstallationPairing(scopeDb({
      device_installations: { data: { ...availableInstallation, archived_at: '2026-09-08' }, error: null },
      brands: { data: { slug: 'coffee-story' }, error: null },
    }), owner, { installationId: INSTALLATION, brandId: null }),
    expectServiceError(404, 'installation_unavailable'));
  });

  it('rejects connected installations and disabled tenant modules', async () => {
    await assert.rejects(createInstallationPairing(scopeDb({
      device_installations: { data: { ...availableInstallation, paired_device_id: 'paired' }, error: null },
      brands: { data: { slug: 'coffee-story' }, error: null },
    }), owner, { installationId: INSTALLATION, brandId: null }),
    expectServiceError(409, 'already_connected'));

    await assert.rejects(createInstallationPairing(scopeDb({
      device_installations: { data: availableInstallation, error: null },
      brands: { data: { slug: 'unconfigured-brand' }, error: null },
    }), owner, { installationId: INSTALLATION, brandId: null }),
    expectServiceError(403, 'module_disabled'));
  });
});
