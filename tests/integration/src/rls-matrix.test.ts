import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSignedInUser, seedBrand, skipUnlessConfigured, sql, userClient } from './stack.ts';

/**
 * The RLS matrix, exercised with real hook-minted JWTs — not simulated
 * claims. Each case is a policy the audit either verified or fixed (0010).
 */
describe('RLS matrix', { skip: skipUnlessConfigured }, () => {
  it('a guest can create and read their own customer row, and only their own', async () => {
    const { brandId } = await seedBrand('rls-guest');
    const other = await sql<{ id: string }>(
      `insert into public.customers (brand_id, full_name, phone)
       values ($1, 'Someone Else', '+15550001111') returning id`,
      [brandId],
    );

    const guest = await createSignedInUser({ userMetadata: { brand_slug: 'rls-guest' } });
    const db = userClient(guest.accessToken);

    const inserted = await db.from('customers')
      .insert({ brand_id: brandId, user_id: guest.userId, full_name: 'Me' })
      .select('id')
      .single();
    assert.equal(inserted.error, null, `guest self-insert should pass: ${inserted.error?.message}`);

    const visible = await db.from('customers').select('id');
    assert.equal(visible.error, null);
    const ids = (visible.data ?? []).map((row) => row.id);
    assert.ok(ids.includes(inserted.data!.id), 'sees own row');
    assert.ok(!ids.includes(other.rows[0]!.id), 'cannot see another guest');
  });

  it('location staff can advance an order at their location; elsewhere is denied', async () => {
    const { brandId, locationId } = await seedBrand('rls-staff');
    const elsewhere = await sql<{ id: string }>(
      `insert into public.locations (brand_id, name, timezone) values ($1, 'Second', 'America/Denver') returning id`,
      [brandId],
    );
    const orderHere = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, status) values ($1, $2, 'paid') returning id`,
      [brandId, locationId],
    );
    const orderThere = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, status) values ($1, $2, 'paid') returning id`,
      [brandId, elsewhere.rows[0]!.id],
    );

    const staff = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'staff', array[$3::uuid])`,
          [userId, brandId, locationId],
        );
      },
    });
    const db = userClient(staff.accessToken);

    const legal = await db.from('order_events').insert({
      brand_id: brandId,
      order_id: orderHere.rows[0]!.id,
      type: 'in_progress',
      source: 'operator',
      actor_user_id: staff.userId,
    });
    assert.equal(legal.error, null, `own-location transition should pass: ${legal.error?.message}`);

    const wrongLocation = await db.from('order_events').insert({
      brand_id: brandId,
      order_id: orderThere.rows[0]!.id,
      type: 'in_progress',
      source: 'operator',
      actor_user_id: staff.userId,
    });
    assert.match(wrongLocation.error?.message ?? '', /row-level security/,
      'other-location transition must be denied by POLICY (not a missing table grant)');
  });

  it('order_events cannot carry a forged brand_id (0010 fix)', async () => {
    const { brandId, locationId } = await seedBrand('rls-forge');
    const foreign = await seedBrand('rls-forge-other');
    const order = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, status) values ($1, $2, 'paid') returning id`,
      [brandId, locationId],
    );
    const staff = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'staff', array[$3::uuid])`,
          [userId, brandId, locationId],
        );
      },
    });
    const db = userClient(staff.accessToken);
    const forged = await db.from('order_events').insert({
      brand_id: foreign.brandId,
      order_id: order.rows[0]!.id,
      type: 'in_progress',
      source: 'operator',
      actor_user_id: staff.userId,
    });
    assert.match(forged.error?.message ?? '', /row-level security/,
      'a brand_id that does not match the order must be denied by POLICY');
  });

  it('staff cannot re-point customers.user_id, and cannot edit prices — but can 86 (0010 fixes)', async () => {
    const { brandId, locationId } = await seedBrand('rls-columns');
    const customer = await sql<{ id: string }>(
      `insert into public.customers (brand_id, full_name) values ($1, 'Guest A') returning id`,
      [brandId],
    );
    await sql(
      `insert into public.orders (brand_id, location_id, customer_id, status) values ($1, $2, $3, 'paid')`,
      [brandId, locationId, customer.rows[0]!.id],
    );
    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published) values ($1, 'Menu', true) returning id`,
      [brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, title) values ($1, $2, 'Drinks') returning id`,
      [brandId, menu.rows[0]!.id],
    );
    const item = await sql<{ id: string }>(
      `insert into public.menu_items (brand_id, menu_id, category_id, slug, name, base_price_cents)
       values ($1, $2, $3, 'latte', 'Latte', 500) returning id`,
      [brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );

    const staff = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'staff', array[$3::uuid])`,
          [userId, brandId, locationId],
        );
      },
    });
    const db = userClient(staff.accessToken);

    const repoint = await db.from('customers')
      .update({ user_id: staff.userId })
      .eq('id', customer.rows[0]!.id);
    assert.ok(repoint.error, 'staff re-pointing user_id must be denied');

    const priceEdit = await db.from('menu_items')
      .update({ base_price_cents: 1 })
      .eq('id', item.rows[0]!.id);
    assert.ok(priceEdit.error, 'staff price edit must be denied');

    const eightySix = await db.from('menu_items')
      .update({ is_86d: true })
      .eq('id', item.rows[0]!.id)
      .select('is_86d')
      .single();
    assert.equal(eightySix.error, null, `staff 86 should pass: ${eightySix.error?.message}`);
    assert.equal(eightySix.data!.is_86d, true);
  });

  it('shift staff see only guests with orders at their location; managers see the brand (0010 fix)', async () => {
    const { brandId, locationId } = await seedBrand('rls-pii');
    const second = await sql<{ id: string }>(
      `insert into public.locations (brand_id, name, timezone) values ($1, 'Second', 'America/Denver') returning id`,
      [brandId],
    );
    const here = await sql<{ id: string }>(
      `insert into public.customers (brand_id, full_name) values ($1, 'Orders Here') returning id`,
      [brandId],
    );
    const there = await sql<{ id: string }>(
      `insert into public.customers (brand_id, full_name) values ($1, 'Orders There') returning id`,
      [brandId],
    );
    await sql(
      `insert into public.orders (brand_id, location_id, customer_id, status) values ($1, $2, $3, 'paid')`,
      [brandId, locationId, here.rows[0]!.id],
    );
    await sql(
      `insert into public.orders (brand_id, location_id, customer_id, status) values ($1, $2, $3, 'paid')`,
      [brandId, second.rows[0]!.id, there.rows[0]!.id],
    );

    const shift = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'staff', array[$3::uuid])`,
          [userId, brandId, locationId],
        );
      },
    });
    const shiftSees = await userClient(shift.accessToken).from('customers').select('id');
    const shiftIds = (shiftSees.data ?? []).map((row) => row.id);
    assert.ok(shiftIds.includes(here.rows[0]!.id), 'shift staff see their location guest');
    assert.ok(!shiftIds.includes(there.rows[0]!.id), 'shift staff must not see other-location PII');

    const manager = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'location_manager', array[$3::uuid])`,
          [userId, brandId, locationId],
        );
      },
    });
    const managerSees = await userClient(manager.accessToken).from('customers').select('id');
    const managerIds = (managerSees.data ?? []).map((row) => row.id);
    assert.ok(managerIds.includes(here.rows[0]!.id) && managerIds.includes(there.rows[0]!.id),
      'managers keep brand scope');
  });

  it('brand isolation: staff of one brand see nothing of another', async () => {
    const a = await seedBrand('rls-iso-a');
    const b = await seedBrand('rls-iso-b');
    await sql(
      `insert into public.orders (brand_id, location_id, status) values ($1, $2, 'paid')`,
      [b.brandId, b.locationId],
    );
    const staffA = await createSignedInUser({
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids)
           values ($1, $2, 'brand_owner', array[$3::uuid])`,
          [userId, a.brandId, a.locationId],
        );
      },
    });
    const db = userClient(staffA.accessToken);
    const orders = await db.from('orders').select('id, brand_id');
    assert.equal(orders.error, null, `query must succeed so emptiness proves ISOLATION: ${orders.error?.message}`);
    assert.ok((orders.data ?? []).every((row) => row.brand_id !== b.brandId), 'no cross-brand orders visible');
    const fees = await db.from('platform_fees').select('id');
    assert.equal(fees.error, null, `platform_fees query must succeed: ${fees.error?.message}`);
    assert.equal((fees.data ?? []).length, 0, 'platform_fees hidden from brand owners');
  });
});
