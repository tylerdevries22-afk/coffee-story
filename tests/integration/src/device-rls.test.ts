import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { asPrincipal, seedBrand, skipUnlessConfigured, sql } from './stack';

/**
 * What a paired device may do, asserted against the policies rather than the
 * app.
 *
 * Three of the five surfaces authenticate as a device rather than a person: a
 * kiosk a guest can touch, a display the room can read, a tablet on a bench.
 * The whole safety argument is that a device claim carries no `role`, so it
 * can never satisfy a staff policy -- and an argument is not a test. These run
 * as the real Postgres roles with real claims.
 */
describe('device scoping', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';
  let otherLocationId = '';
  const devices: Record<string, string> = {};

  /**
   * Runs a statement with a device's claims in place, the way PostgREST does:
   * role `authenticated` plus request.jwt.claims. Rolled back either way, so
   * one assertion never leaves rows behind for the next.
   */
  async function asDevice(deviceId: string, statement: string, params: unknown[] = []) {
    return asPrincipal(
      {
        app_metadata: {
          brand_id: brandId,
          device_id: deviceId,
          device_role: devices[deviceId],
          device_location_id: deviceId === devices.__other ? otherLocationId : locationId,
        },
      },
      statement,
      params,
    );
  }

  async function pair(role: string, atLocation: string): Promise<string> {
    const row = await sql<{ id: string }>(
      `insert into public.devices (brand_id, location_id, role, label, paired_at)
       values ($1, $2, $3::app.device_role, $4, now()) returning id`,
      [brandId, atLocation, role, `${role} under test`],
    );
    const id = row.rows[0]!.id;
    devices[id] = role;
    return id;
  }

  before(async () => {
    ({ brandId, locationId } = await seedBrand(`devices-${randomUUID().slice(0, 8)}`));
    const other = await sql<{ id: string }>(
      `insert into public.locations (brand_id, name, timezone)
       values ($1, 'Second', 'America/Denver') returning id`,
      [brandId],
    );
    otherLocationId = other.rows[0]!.id;
  });

  after(async () => {
    await sql(`delete from public.devices where brand_id = $1`, [brandId]);
  });

  it('activates only a paired, unrevoked device', async () => {
    const paired = await pair('display', locationId);
    const unpaired = await sql<{ id: string }>(
      `insert into public.devices (brand_id, location_id, role, label)
       values ($1, $2, 'display', 'never paired') returning id`,
      [brandId, locationId],
    );
    devices[unpaired.rows[0]!.id] = 'display';

    const active = await asDevice(paired, `select app.device_is_active('display') as ok`);
    assert.equal(active.rows[0]?.ok, true, 'a paired display should be active');

    const inactive = await asDevice(unpaired.rows[0]!.id, `select app.device_is_active('display') as ok`);
    assert.equal(inactive.rows[0]?.ok, false, 'an unpaired device must never be active');
  });

  it('deactivates the moment it is revoked, without waiting for the token to expire', async () => {
    const id = await pair('display', locationId);
    await sql(`update public.devices set revoked_at = now() where id = $1`, [id]);
    const result = await asDevice(id, `select app.device_is_active('display') as ok`);
    assert.equal(result.rows[0]?.ok, false, 'revoking in HQ must take effect at once');
  });

  it('will not let a device claim satisfy a staff policy', async () => {
    // The load-bearing assertion. A device carries no `role`, so every
    // is_brand_* helper must fail for it however the rest of the claim looks.
    const id = await pair('pos', locationId);
    const result = await asDevice(
      id,
      `select app.is_brand_staff($1) as staff, app.is_brand_owner($1) as owner, app.jwt_role() as role`,
      [brandId],
    );
    const row = result.rows[0] as { staff: boolean; owner: boolean; role: string | null };
    assert.equal(row.staff, false, 'a device is not staff');
    assert.equal(row.owner, false, 'a device is not an owner');
    assert.equal(row.role, null, 'a device claim must carry no staff role at all');
  });

  it('refuses a role the device was not paired as', async () => {
    // A prep tablet holding a kiosk-shaped claim must not get order-create
    // scope by asking for it.
    const id = await pair('prep', locationId);
    const result = await asDevice(id, `select app.device_is_active('kiosk') as ok`);
    assert.equal(result.rows[0]?.ok, false);
  });

  it('scopes a device to the location it was paired at', async () => {
    const id = await pair('display', otherLocationId);
    devices.__other = id;
    // Claims say the second location, the row says the second location: active.
    const atOwn = await asDevice(id, `select app.device_is_active('display') as ok`);
    assert.equal(atOwn.rows[0]?.ok, true);
  });
});
