import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createSignedInUser, seedBrand, skipUnlessConfigured, sql, userClient } from './stack.ts';

async function staffFor(
  brandId: string,
  locationId: string,
  role: 'brand_owner' | 'location_manager' | 'staff',
) {
  return createSignedInUser({
    before: async (userId) => {
      await sql(
        `insert into public.brand_users (user_id, brand_id, role, location_ids)
         values ($1, $2, $3, array[$4::uuid])`,
        [userId, brandId, role, locationId],
      );
    },
  });
}

async function installation(input: {
  brandId: string;
  locationId: string;
  userId: string;
  label: string;
}) {
  const identity = randomUUID().replaceAll('-', '').padEnd(64, '0');
  return sql<{ id: string }>(
    `insert into public.device_installations (
       id, brand_id, location_id, installed_by, label, form_factor, app_target,
       platform, app_version, runtime_version, capabilities, identity_fingerprint
     ) values (gen_random_uuid(), $1, $2, $3, $4, 'tablet', 'operator',
       'ios', '1.0.0', 'exposdk-54.0.0', array['heartbeat'], $5)
     returning id`,
    [input.brandId, input.locationId, input.userId, input.label, identity],
  );
}

describe('Device Wall RLS', { skip: skipUnlessConfigured }, () => {
  it('isolates inventory by tenant and manager location', async () => {
    const own = await seedBrand(`wall-a-${randomUUID().slice(0, 8)}`);
    const foreign = await seedBrand(`wall-b-${randomUUID().slice(0, 8)}`);
    const second = await sql<{ id: string }>(
      `insert into public.locations (brand_id, name, timezone)
       values ($1, 'Second', 'America/Denver') returning id`,
      [own.brandId],
    );
    const owner = await staffFor(own.brandId, own.locationId, 'brand_owner');
    const manager = await staffFor(own.brandId, own.locationId, 'location_manager');
    await installation({ ...own, userId: owner.userId, label: 'Own location' });
    await installation({
      brandId: own.brandId, locationId: second.rows[0]!.id,
      userId: owner.userId, label: 'Other location',
    });
    await installation({ ...foreign, userId: owner.userId, label: 'Other tenant' });

    const ownerRows = await userClient(owner.accessToken).from('device_installations').select('label');
    assert.equal(ownerRows.error, null);
    assert.deepEqual((ownerRows.data ?? []).map((row) => row.label).sort(), ['Other location', 'Own location']);

    const managerRows = await userClient(manager.accessToken).from('device_installations').select('label');
    assert.equal(managerRows.error, null);
    assert.deepEqual((managerRows.data ?? []).map((row) => row.label), ['Own location']);
  });

  it('keeps personal layouts private and blocks direct privileged writes', async () => {
    const brand = await seedBrand(`wall-layout-${randomUUID().slice(0, 8)}`);
    const owner = await staffFor(brand.brandId, brand.locationId, 'brand_owner');
    const staff = await staffFor(brand.brandId, brand.locationId, 'staff');
    const db = userClient(staff.accessToken);
    const ownLayout = await db.from('device_wall_layouts').insert({
      brand_id: brand.brandId, user_id: staff.userId,
      location_id: brand.locationId, layout: [],
    });
    assert.equal(ownLayout.error, null, ownLayout.error?.message);
    const forgedLayout = await db.from('device_wall_layouts').insert({
      brand_id: brand.brandId, user_id: owner.userId,
      location_id: brand.locationId, layout: [],
    });
    assert.ok(forgedLayout.error, 'staff must not write another user layout');
    const diagnostics = await db.from('device_diagnostic_runs').insert({
      installation_id: randomUUID(), brand_id: brand.brandId,
      location_id: brand.locationId, requested_by: staff.userId, results: [],
    });
    assert.ok(diagnostics.error, 'clients must not insert owner diagnostics directly');
    const enrollment = await userClient(owner.accessToken).from('device_wall_enrollment_codes')
      .select('id');
    assert.ok(enrollment.error, 'hashed enrollment credentials are service-only');
  });

  it('never grants managers public device identity material', async () => {
    const brand = await seedBrand(`wall-key-${randomUUID().slice(0, 8)}`);
    const owner = await staffFor(brand.brandId, brand.locationId, 'brand_owner');
    const manager = await staffFor(brand.brandId, brand.locationId, 'location_manager');
    await installation({ ...brand, userId: owner.userId, label: 'Protected key' });
    const keys = await userClient(manager.accessToken).from('device_installations')
      .select('public_key_jwk');
    assert.ok(keys.error, 'public identity columns are not granted to authenticated clients');
  });
});
