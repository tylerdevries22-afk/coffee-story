import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSignedInUser, seedBrand, skipUnlessConfigured, sql, userClient } from './stack.ts';

/**
 * Two things the audits found that only a real database can prove: what a
 * brand claim is actually worth, and whether the drop metric can match an
 * order at all.
 */
describe('what a brand claim is worth', { skip: skipUnlessConfigured }, () => {
  it('never shows one tenant the platform’s commercial terms with another', async () => {
    const { brandId } = await seedBrand('terms-owner');
    await sql(
      `update public.brands set fee_bps = 275, fee_bps_tier2 = 125, tier_threshold_cents = 500000 where id = $1`,
      [brandId],
    );

    // A guest who simply named this brand's slug at sign-up. The claims hook
    // bootstraps a brand_id from user_metadata, which is user-writable, so
    // holding this claim proves nothing about belonging to the brand.
    const outsider = await createSignedInUser({ userMetadata: { brand_slug: 'terms-owner' } });
    assert.equal(outsider.claims.brand_id, brandId, 'the bootstrap really does mint the claim');

    const asOutsider = userClient(outsider.accessToken);
    const brands = await asOutsider.from('brands').select('id, fee_bps, fee_bps_tier2, tier_threshold_cents');
    assert.equal(brands.error, null);
    assert.deepEqual(brands.data, [], 'the fee terms are staff-only, claim or no claim');

    // The storefront is what a guest is supposed to read, and it still works.
    const storefront = await asOutsider
      .from('brand_storefront')
      .select('*')
      .eq('id', brandId)
      .maybeSingle<Record<string, unknown>>();
    assert.equal(storefront.error, null);
    assert.ok(storefront.data, 'a guest can still bootstrap the storefront');
    for (const column of ['fee_bps', 'fee_bps_tier2', 'tier_threshold_cents']) {
      assert.equal(column in storefront.data, false, `${column} is not on the storefront`);
    }
  });

  it('lets the brand’s own staff read its terms', async () => {
    const { brandId } = await seedBrand('terms-staff');
    const staff = await createSignedInUser({
      userMetadata: { brand_slug: 'terms-staff' },
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'brand_owner', '{}')`,
          [userId, brandId],
        );
      },
    });
    const brands = await userClient(staff.accessToken)
      .from('brands').select('id, fee_bps').eq('id', brandId);
    assert.equal(brands.error, null);
    assert.equal(brands.data?.length, 1, 'staff still see their own brand');
  });
});

describe('drop_performance', { skip: skipUnlessConfigured }, () => {
  it('counts the orders that actually contain the drop’s item', async () => {
    const { brandId, locationId } = await seedBrand('drop-metrics');
    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published) values ($1, 'Menu', true) returning id`,
      [brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, slug, title, sort_order)
       values ($1, $2, 'drops', 'Drops', 1) returning id`,
      [brandId, menu.rows[0]!.id],
    );
    const item = await sql<{ id: string }>(
      `insert into public.menu_items (brand_id, menu_id, category_id, slug, name, base_price_cents, sizes, modifiers, sort_order)
       values ($1, $2, $3, 'pistachio-drop', 'Pistachio Drop', 700, '[]'::jsonb, '[]'::jsonb, 1)
       returning id`,
      [brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );
    const drop = await sql<{ id: string }>(
      `insert into public.drops (brand_id, item_id, starts_at, ends_at, status)
       values ($1, $2, now() - interval '1 hour', now() + interval '1 hour', 'live')
       returning id`,
      [brandId, item.rows[0]!.id],
    );

    // One order carrying the drop's item, written the way createOrder writes
    // it: lines keyed by item_slug. The view used to look for an item_id that
    // no snapshot has ever contained, so it always counted zero.
    const order = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, status, total_cents, subtotal_cents, totals)
       values ($1, $2, 'created', 700, 700,
         '{"lines":[{"item_slug":"pistachio-drop","name":"Pistachio Drop","quantity":1,"unit_price_cents":700,"options":[]}]}'::jsonb)
       returning id`,
      [brandId, locationId],
    );
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'paid', 'system')`,
      [brandId, order.rows[0]!.id],
    );
    // And one that does not, to prove the join discriminates.
    const other = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, status, total_cents, subtotal_cents, totals)
       values ($1, $2, 'created', 400, 400,
         '{"lines":[{"item_slug":"drip","name":"Drip","quantity":1,"unit_price_cents":400,"options":[]}]}'::jsonb)
       returning id`,
      [brandId, locationId],
    );
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'paid', 'system')`,
      [brandId, other.rows[0]!.id],
    );

    const performance = await sql<{ orders_count: string; revenue_cents: string }>(
      `select orders_count, revenue_cents from public.drop_performance where drop_id = $1`,
      [drop.rows[0]!.id],
    );
    assert.equal(Number(performance.rows[0]?.orders_count), 1, 'the drop’s own order is counted');
    assert.equal(Number(performance.rows[0]?.revenue_cents), 700, 'and its money with it');
  });
});
