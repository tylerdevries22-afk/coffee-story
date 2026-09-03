import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveTenantCapabilities,
  type BrandCapabilityFlags,
  type CapabilityTelemetry,
} from './capabilities';

const BRAND = '11111111-1111-4111-8111-111111111111';
const AT = '2026-09-02T00:00:00.000Z';

const ALL_FLAGS: BrandCapabilityFlags = {
  drops: true, catering: true, delivery: true,
  stored_value: true, referrals: true, operations: true,
};

const ACTIVE_SIX = [
  'growth-stored-value', 'growth-referrals', 'growth-drops',
  'commerce-catering', 'commerce-delivery', 'workforce-operations',
].map((moduleKey) => ({
  module_key: moduleKey, version: '1.0.0', state: 'active', config_revision: 1,
}));

function fakeDb(
  brand: { data: BrandCapabilityFlags | null; error: { message: string } | null },
  installations: { data: unknown[] | null; error: { message: string } | null },
): SupabaseClient {
  const brandQuery = {
    select: () => brandQuery,
    eq: () => brandQuery,
    maybeSingle: async () => brand,
  };
  const installationQuery = {
    select: () => installationQuery,
    eq: () => installationQuery,
    returns: async () => installations,
  };
  return {
    from: (table: string) => (table === 'brands' ? brandQuery : installationQuery),
  } as unknown as SupabaseClient;
}

function capture(): { telemetry: CapabilityTelemetry; warnings: unknown[]; errors: unknown[] } {
  const warnings: unknown[] = [];
  const errors: unknown[] = [];
  return {
    warnings,
    errors,
    telemetry: {
      warn: (line) => warnings.push(line),
      error: (line) => errors.push(line),
      now: () => new Date(AT),
    },
  };
}

describe('resolveTenantCapabilities', () => {
  it('resolves without logging when flags and installations agree', async () => {
    const { telemetry, warnings, errors } = capture();
    const resolution = await resolveTenantCapabilities(
      fakeDb({ data: ALL_FLAGS, error: null }, { data: ACTIVE_SIX, error: null }),
      BRAND,
      telemetry,
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(errors, []);
    assert.equal(resolution?.brandId, BRAND);
    assert.deepEqual(resolution?.drift, []);
    assert.deepEqual(resolution?.modules, [...ACTIVE_SIX.map((row) => row.module_key)].sort());
  });

  it('emits one structured drift line when the surfaces disagree', async () => {
    const { telemetry, warnings, errors } = capture();
    const installations = ACTIVE_SIX.map((row) => (
      row.module_key === 'workforce-operations' ? { ...row, state: 'suspended' } : row
    ));
    const resolution = await resolveTenantCapabilities(
      fakeDb({ data: ALL_FLAGS, error: null }, { data: installations, error: null }),
      BRAND,
      telemetry,
    );
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], {
      event: 'capability_drift',
      brandId: BRAND,
      drift: [{
        moduleKey: 'workforce-operations', flag: true,
        installationState: 'suspended', direction: 'flag-only',
      }],
      at: AT,
    });
    assert.equal(resolution?.drift.length, 1);
  });

  it('logs capability_drift_error and returns null when a read fails', async () => {
    const { telemetry, warnings, errors } = capture();
    const resolution = await resolveTenantCapabilities(
      fakeDb({ data: null, error: { message: 'brands read denied' } }, { data: [], error: null }),
      BRAND,
      telemetry,
    );
    assert.equal(resolution, null);
    assert.deepEqual(warnings, []);
    assert.deepEqual(errors, [
      { event: 'capability_drift_error', brandId: BRAND, reason: 'brands read denied', at: AT },
    ]);
  });

  it('fails open when the resolver throws', async () => {
    const { telemetry, warnings, errors } = capture();
    const throwing = {
      from: () => { throw new Error('client exploded'); },
    } as unknown as SupabaseClient;
    const resolution = await resolveTenantCapabilities(throwing, BRAND, telemetry);
    assert.equal(resolution, null);
    assert.deepEqual(warnings, []);
    assert.deepEqual(errors, [
      { event: 'capability_drift_error', brandId: BRAND, reason: 'client exploded', at: AT },
    ]);
  });
});
