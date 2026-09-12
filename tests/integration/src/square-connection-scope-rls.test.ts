import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { asPrincipal } from './principal.ts';
import { seedBrand, sql, stack } from './stack.ts';

/**
 * Regression for 20260722000031_close_definer_view_writes_and_scope_holes.sql
 * item 1. That migration's own comment records the exploit it closes: a
 * signed-in user holding no brand claim at all could `delete from
 * public.brand_storefront`, and a shift lead's `delete from
 * public.location_square_status` destroyed their own brand's Square
 * connection -- writes travelling through a definer view's automatically-
 * updatable columns, entirely outside RLS. 0031's own fix was a plain REVOKE
 * of insert/update/delete on the view; by 20260908228000 the view was also
 * rebuilt over a SECURITY DEFINER function (`app.location_square_status_rows`)
 * rather than the bare table, which makes it structurally non-updatable, so
 * a write against the CURRENT schema fails at parse time ("cannot delete/
 * update view") rather than at the grant check -- confirmed empirically
 * below, not assumed. Either failure mode proves the hole stays closed, so
 * both are accepted. The base table's own denial is still a plain grant-level
 * "permission denied", unaffected by that later rebuild. Nothing in
 * tests/integration ever exercised these two relations as a signed-in
 * non-service principal before this file; every prior mention is service-role
 * fixture setup.
 */
const VIEW_WRITE_DENIED = /permission denied|cannot (?:delete from|update) view/;
describe('square connection scope holes stay closed (0031)', { skip: !stack.dbUrl }, () => {
  async function fixture(tag: string) {
    // brands.slug forbids underscores; role names like 'location_manager' have them.
    const { brandId, locationId } = await seedBrand(`sqconn-${tag.replaceAll('_', '-')}`);
    const created = await sql<{ id: string }>(
      `insert into public.square_connections
         (brand_id, location_id, merchant_id, access_token_encrypted, refresh_token_encrypted, expires_at)
       values ($1, $2, 'merchant-1', 'ct-access', 'ct-refresh', now() + interval '1 day')
       returning id`,
      [brandId, locationId],
    );
    return { brandId, locationId, connectionId: created.rows[0]!.id };
  }

  for (const role of ['staff', 'location_manager']) {
    it(`refuses a ${role} every write and read on square_connections and its status view`, async () => {
      const { brandId, locationId, connectionId } = await fixture(role);
      const claims = { app_metadata: { brand_id: brandId, role, location_ids: [locationId] } };

      await assert.rejects(
        asPrincipal(claims,
          `select access_token_encrypted from public.square_connections where id = $1`, [connectionId]),
        /permission denied/, `${role} read the token ciphertext directly`,
      );
      await assert.rejects(
        asPrincipal(claims,
          `insert into public.square_connections
             (brand_id, location_id, merchant_id, access_token_encrypted, refresh_token_encrypted, expires_at)
           values ($1, $2, 'merchant-2', 'x', 'y', now())`, [brandId, locationId]),
        /permission denied/, `${role} inserted a square_connections row`,
      );
      await assert.rejects(
        asPrincipal(claims,
          `update public.square_connections set merchant_id = 'owned' where id = $1`, [connectionId]),
        /permission denied/, `${role} updated square_connections directly`,
      );
      await assert.rejects(
        asPrincipal(claims, `delete from public.square_connections where id = $1`, [connectionId]),
        /permission denied/, `${role} deleted square_connections directly`,
      );
      // The exploited path: the view, not the base table.
      await assert.rejects(
        asPrincipal(claims,
          `delete from public.location_square_status where location_id = $1`, [locationId]),
        VIEW_WRITE_DENIED, `${role} deleted through location_square_status`,
      );
      await assert.rejects(
        asPrincipal(claims,
          `update public.location_square_status set merchant_id = 'owned' where location_id = $1`, [locationId]),
        VIEW_WRITE_DENIED, `${role} updated through location_square_status`,
      );

      const survives = await sql<{ merchant_id: string; access_token_encrypted: string }>(
        `select merchant_id, access_token_encrypted from public.square_connections where id = $1`,
        [connectionId],
      );
      assert.equal(survives.rowCount, 1, 'the connection row must survive every attempt above');
      assert.equal(survives.rows[0]!.merchant_id, 'merchant-1', 'no write went through');
      assert.equal(survives.rows[0]!.access_token_encrypted, 'ct-access', 'the token ciphertext is unchanged');
    });
  }

  it('still lets staff read connection status through the intended safe projection', async () => {
    const { brandId, locationId } = await fixture('read-check');
    const claims = { app_metadata: { brand_id: brandId, role: 'staff', location_ids: [locationId] } };
    const result = await asPrincipal(
      claims, `select merchant_id, expires_at from public.location_square_status where location_id = $1`, [locationId],
    );
    assert.equal(result.rowCount, 1, 'the fix must not also break the read this view exists for');
    assert.equal(Object.hasOwn(result.rows[0]!, 'access_token_encrypted'), false, 'the view never carries token columns');
  });
});
