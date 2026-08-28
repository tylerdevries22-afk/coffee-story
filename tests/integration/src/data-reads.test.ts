import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fetchBrandBySlug,
  fetchCustomerOrders,
  fetchLoyaltySummary,
  fetchMenuTree,
} from '@platform/data';

import { anonClient, createSignedInUser, seedBrand, skipUnlessConfigured, sql, userClient } from './stack.ts';

/**
 * @platform/data against the real schema: a malformed select or a wrong
 * column name in the read layer only ever fails at runtime, so every reader
 * gets exercised here once against seeded rows.
 */
describe('@platform/data reads', { skip: skipUnlessConfigured }, () => {
  it('fetchBrandBySlug + fetchMenuTree serve the anonymous storefront', async () => {
    const { brandId } = await seedBrand('data-reads');
    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published) values ($1, 'Menu', true)
       returning id`,
      [brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, slug, title, sort_order)
       values ($1, $2, 'drinks', 'Drinks', 1) returning id`,
      [brandId, menu.rows[0]!.id],
    );
    await sql(
      `insert into public.menu_items (brand_id, menu_id, category_id, slug, name, base_price_cents, sort_order)
       values ($1, $2, $3, 'latte', 'Latte', 500, 1), ($1, $2, $3, 'mocha', 'Mocha', 600, 2)`,
      [brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );
    await sql(
      `update public.menu_items set is_listed = false where brand_id = $1 and slug = 'mocha'`,
      [brandId],
    );

    const anon = anonClient();
    const summary = await fetchBrandBySlug(anon, 'data-reads');
    assert.ok(summary, 'brand visible to the anonymous storefront');
    assert.equal(summary!.locations.length, 1);
    assert.ok(!('fee_bps' in (summary!.brand as object)), 'the platform fee terms never reach the storefront');
    const direct = await anon.from('brands').select('id').eq('id', brandId);
    assert.equal((direct.data ?? []).length, 0, 'the brands table itself stays claim-gated for anon');

    const tree = await fetchMenuTree(anon, brandId);
    assert.equal(tree.categories.length, 1);
    assert.deepEqual(tree.categories[0]!.items.map((item) => item.slug), ['latte'], 'unlisted item filtered');
  });

  it('fetchCustomerOrders and fetchLoyaltySummary read a guest own data under RLS', async () => {
    const { brandId, locationId } = await seedBrand('data-reads-guest');
    const guest = await createSignedInUser({ userMetadata: { brand_slug: 'data-reads-guest' } });
    const customer = await sql<{ id: string }>(
      `insert into public.customers (brand_id, user_id, full_name) values ($1, $2, 'Reader') returning id`,
      [brandId, guest.userId],
    );
    const customerId = customer.rows[0]!.id;
    await sql(
      `insert into public.orders (brand_id, location_id, customer_id, status, total_cents)
       values ($1, $2, $3, 'ready', 700), ($1, $2, $3, 'picked_up', 900)`,
      [brandId, locationId, customerId],
    );
    const account = await sql<{ id: string }>(
      `insert into public.loyalty_accounts (brand_id, customer_id, points_balance, lifetime_points)
       values ($1, $2, 120, 340) returning id`,
      [brandId, customerId],
    );
    await sql(
      `insert into public.loyalty_events (brand_id, account_id, type, points, note)
       values ($1, $2, 'earn', 120, 'seed')`,
      [brandId, account.rows[0]!.id],
    );

    const db = userClient(guest.accessToken);
    const orders = await fetchCustomerOrders(db, customerId);
    assert.equal(orders.active.length, 1);
    assert.equal(orders.past.length, 1);

    const loyalty = await fetchLoyaltySummary(db, customerId);
    assert.equal(loyalty.account?.points_balance, 120);
    assert.equal(loyalty.ledger.length, 1);
    assert.equal(loyalty.storedValueBalanceCents, 0);
  });
});
