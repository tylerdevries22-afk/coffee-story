import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type pg from 'pg';

import { databaseClient, stack } from './stack.ts';

async function seed(client: pg.Client) {
  const brandId = randomUUID();
  const locationId = randomUUID();
  const catalogId = randomUUID();
  const releaseId = randomUUID();
  const userId = randomUUID();
  const memberId = randomUUID();
  await client.query('insert into public.brands (id, slug, name) values ($1, $2, $2)',
    [brandId, `catalog-rls-${brandId}`]);
  await client.query('insert into public.locations (id, brand_id, name) values ($1, $2, $3)',
    [locationId, brandId, 'Main']);
  await client.query('insert into auth.users (id, email) values ($1, $2)',
    [userId, `${userId}@integration.local`]);
  await client.query(`insert into public.brand_users (id, user_id, brand_id, role)
    values ($1, $2, $3, 'brand_owner')`, [memberId, userId, brandId]);
  await client.query('insert into public.menus (id, brand_id) values ($1, $2)', [catalogId, brandId]);
  await client.query(`insert into public.catalogs (id, brand_id) values ($1, $2)
    on conflict (id) do nothing`, [catalogId, brandId]);
  await client.query(`insert into public.catalog_releases
    (id, brand_id, catalog_id, version, status, manifest, created_by)
    values ($1, $2, $3, 1, 'published', '{}', $4)`, [releaseId, brandId, catalogId, memberId]);
  await client.query(`insert into public.catalog_publications (brand_id, catalog_id, release_id, version)
    values ($1, $2, $3, 1)`, [brandId, catalogId, releaseId]);
  await client.query(`insert into public.brand_config_signals (brand_id) values ($1)
    on conflict (brand_id) do nothing`, [brandId]);
  await client.query(`insert into public.location_setting_signals (location_id, brand_id)
    values ($1, $2) on conflict (location_id) do nothing`, [locationId, brandId]);
  return { brandId, locationId, memberId, releaseId };
}

async function principal(client: pg.Client, role: string, brandId: string, databaseRole = 'authenticated') {
  await client.query(databaseRole === 'anon' ? 'set local role anon' : 'set local role authenticated');
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({
    role: databaseRole, app_metadata: { role, brand_id: brandId, location_ids: [] },
  })]);
}

describe('catalog and signal metadata isolation', { skip: !stack.dbUrl }, () => {
  it('denies cross-brand metadata while keeping owner, guest and anonymous reads usable', async () => {
    const client = databaseClient();
    await client.connect();
    try {
      await client.query('begin');
      const a = await seed(client);
      const b = await seed(client);
      const brandIds = [a.brandId, b.brandId];
      for (const role of ['brand_owner', 'staff', 'customer']) {
        await principal(client, role, a.brandId);
        const releases = await client.query(`select brand_id, created_by from public.catalog_releases
          where brand_id = any($1::uuid[])`, [brandIds]);
        assert.deepEqual(releases.rows, role === 'customer' ? [] : [{
          brand_id: a.brandId, created_by: a.memberId,
        }], `${role} release metadata`);
        for (const table of ['catalog_publications', 'brand_config_signals', 'location_setting_signals']) {
          // These are fixed test-owned relation names, never request input.
          const result = await client.query(`select brand_id from public.${table}
            where brand_id = any($1::uuid[])`, [brandIds]);
          assert.deepEqual(result.rows, [{ brand_id: a.brandId }], `${role} ${table}`);
        }
        const guest = await client.query('select * from public.published_catalog_lookup($1)', [b.brandId]);
        assert.equal(guest.rows[0]?.id, b.releaseId);
        assert.equal(Object.hasOwn(guest.rows[0], 'created_by'), false);
      }
      await principal(client, 'platform_admin', a.brandId);
      assert.equal((await client.query(`select created_by from public.catalog_releases
        where brand_id = any($1::uuid[])`, [brandIds])).rowCount, 2);

      await principal(client, '', a.brandId, 'anon');
      for (const table of ['catalog_publications', 'brand_config_signals']) {
        assert.equal((await client.query(`select brand_id from public.${table}
          where brand_id = any($1::uuid[])`, [brandIds])).rowCount, 2);
      }
      assert.equal((await client.query(`select location_id from public.location_setting_signals
        where location_id = any($1::uuid[])`, [[a.locationId, b.locationId]])).rowCount, 2);
      const guest = await client.query('select * from public.published_catalog_lookup($1)', [b.brandId]);
      assert.equal(guest.rows[0]?.id, b.releaseId);
      assert.equal(Object.hasOwn(guest.rows[0], 'created_by'), false);
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });
});
