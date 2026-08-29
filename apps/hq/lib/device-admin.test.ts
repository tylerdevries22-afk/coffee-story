import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantClaims } from '@platform/schema';
import { DeviceError, type DeviceSigningKey } from '@platform/engine';

import {
  DeviceAdminError, deviceAdminStatus, issueRefreshSecret, locationOfManagedDevice,
  pairDevice, revokePairedDevice,
} from './device-admin';

const KEY: DeviceSigningKey = { secret: 'a'.repeat(48), issuer: 'https://example.test/auth/v1' };
const BRAND = '11111111-1111-4111-8111-111111111111';
const HERE = '33333333-3333-4333-8333-333333333333';
const ELSEWHERE = '44444444-4444-4444-8444-444444444444';
const DEVICE = '22222222-2222-4222-8222-222222222222';

const owner: TenantClaims = { brand_id: BRAND, location_ids: [], role: 'brand_owner' };
const manager: TenantClaims = { brand_id: BRAND, location_ids: [HERE], role: 'location_manager' };
const guest: TenantClaims = { brand_id: BRAND, location_ids: [] };

/** Thrown if a write is attempted, so a test can prove authorization ran first. */
class ReachedEngine extends Error {}

/**
 * A devices table that answers the location lookup and refuses everything
 * else. Any engine write lands in ReachedEngine, which is how these tests tell
 * "refused before doing anything" from "refused after".
 */
function deviceDb(row: { location_id: string } | null): SupabaseClient {
  const lookup = {
    select: () => lookup,
    eq: () => lookup,
    maybeSingle: async () => ({ data: row, error: null }),
    insert: () => { throw new ReachedEngine('insert'); },
    update: () => { throw new ReachedEngine('update'); },
  };
  return { from: () => lookup } as unknown as SupabaseClient;
}

const deps = (row: { location_id: string } | null) => ({ db: deviceDb(row), loadKey: () => KEY });

describe('locationOfManagedDevice', () => {
  it('gives a manager the location of a device at their own store', async () => {
    assert.equal(await locationOfManagedDevice(deps({ location_id: HERE }), manager, DEVICE), HERE);
  });

  it('refuses a manager a device at another of the brand stores', async () => {
    await assert.rejects(
      () => locationOfManagedDevice(deps({ location_id: ELSEWHERE }), manager, DEVICE),
      (error: DeviceAdminError) => error.code === 'forbidden',
    );
  });

  /**
   * A device id that exists elsewhere and one that does not exist at all must
   * be indistinguishable, or the endpoint becomes an oracle for enumerating
   * another store's hardware.
   */
  it('answers a missing device exactly as it answers someone else\'s', async () => {
    const missing = await locationOfManagedDevice(deps(null), manager, DEVICE)
      .catch((error: DeviceAdminError) => error.message);
    const theirs = await locationOfManagedDevice(deps({ location_id: ELSEWHERE }), manager, DEVICE)
      .catch((error: DeviceAdminError) => error.message);
    assert.equal(missing, theirs);
  });

  it('lets a brand owner reach any of the brand locations', async () => {
    assert.equal(await locationOfManagedDevice(deps({ location_id: ELSEWHERE }), owner, DEVICE), ELSEWHERE);
  });

  it('refuses a guest, who has a brand but no role', async () => {
    await assert.rejects(
      () => locationOfManagedDevice(deps({ location_id: HERE }), guest, DEVICE),
      (error: DeviceAdminError) => error.code === 'forbidden',
    );
  });
});

describe('pairDevice', () => {
  const good = { locationId: HERE, role: 'display', label: 'Front counter' };

  it('refuses a role that is not a screen', async () => {
    await assert.rejects(
      () => pairDevice(deps(null), manager, { ...good, role: 'brand_owner' }),
      (error: DeviceAdminError) => error.code === 'invalid_request',
    );
  });

  it('refuses a location the caller does not manage, before writing anything', async () => {
    await assert.rejects(
      () => pairDevice(deps(null), manager, { ...good, locationId: ELSEWHERE }),
      (error: DeviceAdminError) => error.code === 'forbidden',
    );
  });

  it('refuses an empty or oversized label', async () => {
    for (const label of ['', '   ', 'x'.repeat(61)]) {
      await assert.rejects(
        () => pairDevice(deps(null), manager, { ...good, label }),
        (error: DeviceAdminError) => error.code === 'invalid_request',
      );
    }
  });

  it('reaches the engine once the caller and the location check out', async () => {
    await assert.rejects(() => pairDevice(deps(null), manager, good), ReachedEngine);
  });
});

describe('issueRefreshSecret', () => {
  it('refuses a device at another store without minting anything', async () => {
    await assert.rejects(
      () => issueRefreshSecret(deps({ location_id: ELSEWHERE }), manager, DEVICE),
      (error: DeviceAdminError) => error.code === 'forbidden',
    );
  });

  /**
   * The stub's device row is not paired, so the engine refuses it -- which is
   * the point: a DeviceError rather than a DeviceAdminError means the
   * authorization check passed and the engine took over.
   */
  it('hands a device the caller manages to the engine', async () => {
    await assert.rejects(
      () => issueRefreshSecret(deps({ location_id: HERE }), manager, DEVICE),
      DeviceError,
    );
  });
});

describe('revokePairedDevice', () => {
  /**
   * This is the case that used to be allowed. Pairing and secret issuance both
   * checked the location; revoke checked only that the caller held some role,
   * so a barista at one store could stop the pickup display at another.
   */
  it('refuses to stop a screen at a store the caller does not manage', async () => {
    await assert.rejects(
      () => revokePairedDevice(deps({ location_id: ELSEWHERE }), manager, DEVICE),
      (error: DeviceAdminError) => error.code === 'forbidden',
    );
  });

  it('still lets a brand owner stop any screen in the brand', async () => {
    await assert.rejects(
      () => revokePairedDevice(deps({ location_id: ELSEWHERE }), owner, DEVICE),
      ReachedEngine,
    );
  });
});

describe('deviceAdminStatus', () => {
  it('separates a refusal from a bad request', () => {
    assert.equal(deviceAdminStatus(new DeviceAdminError('forbidden', 'no'))?.status, 403);
    assert.equal(deviceAdminStatus(new DeviceAdminError('invalid_request', 'no'))?.status, 400);
  });

  it('keeps not_configured a 501, so a missing signing key reads as unbuilt not broken', () => {
    assert.equal(deviceAdminStatus(new DeviceError('not_configured', 'no key'))?.status, 501);
    assert.equal(deviceAdminStatus(new DeviceError('pairing_unknown', 'nope'))?.status, 400);
  });

  it('passes an unrecognised error through, so a bug is not answered as a 400', () => {
    assert.equal(deviceAdminStatus(new TypeError('bug')), null);
  });
});
