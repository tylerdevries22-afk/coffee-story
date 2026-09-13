import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type pg from 'pg';

import { databaseClient, seedBrand, sql, stack } from './stack.ts';

/** Role `authenticated` plus both JWT claim shapes the policies read: the
 * bundled app_metadata object for is_brand_staff/jwt_role, and the bare
 * `sub` GUC the local shim's auth.uid() reads (mirrors
 * arrival-concurrency.test.ts's beginCustomer). */
async function principal(client: pg.Client, role: string, brandId: string, userId: string): Promise<void> {
  await client.query('set local role authenticated');
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({
    sub: userId, role: 'authenticated', app_metadata: { brand_id: brandId, role },
  })]);
  await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId]);
}

async function customer(brandId: string): Promise<{ userId: string; customerId: string }> {
  const userId = randomUUID();
  await sql(`insert into auth.users (id, email) values ($1, $2)`, [userId, `${userId}@integration.local`]);
  const row = await sql<{ id: string }>(
    `insert into public.customers (brand_id, user_id, full_name) values ($1, $2, 'Guest') returning id`,
    [brandId, userId],
  );
  return { userId, customerId: row.rows[0]!.id };
}

async function ledgerRow(brandId: string, customerId: string): Promise<string> {
  const row = await sql<{ id: string }>(
    `insert into public.stored_value_ledger (brand_id, customer_id, type, amount_cents, balance_after_cents)
     values ($1, $2, 'load', 500, 500) returning id`,
    [brandId, customerId],
  );
  return row.rows[0]!.id;
}

/**
 * Regression for the narrowing in 20260722000031:125-132 (item 4 of that
 * migration): before it, `stored_value_select` was bare `app.is_brand_staff
 * (brand_id)`, so any staff member of the row's brand read any guest's
 * stored-value balance with no per-customer or per-location scoping.
 * tests/integration has never exercised this policy as a signed-in
 * principal; every existing mention of stored_value_ledger is service-role
 * fixture setup (seedBrand's cleanup list, order-cancel refund paths).
 */
describe('stored_value_ledger RLS', { skip: !stack.dbUrl }, () => {
  it('scopes reads to the owning customer and the row brand\'s staff, denying everyone else', async () => {
    const brandA = await seedBrand('svl-brand-a');
    const brandB = await seedBrand('svl-brand-b');
    const owner = await customer(brandA.brandId);
    const otherGuest = await customer(brandA.brandId);
    const ledgerId = await ledgerRow(brandA.brandId, owner.customerId);

    const client = databaseClient();
    await client.connect();
    try {
      await client.query('begin');

      // Baseline first: the denial below cannot mean anything if this is
      // already empty for a reason unrelated to ownership.
      await principal(client, 'customer', brandA.brandId, owner.userId);
      const own = await client.query('select id from public.stored_value_ledger where id = $1', [ledgerId]);
      assert.deepEqual(own.rows.map((r) => r.id), [ledgerId], 'the owning customer must see their own balance');

      // A different guest at the SAME brand: proves ownership is scoped per
      // customer, not merely per brand.
      await principal(client, 'customer', brandA.brandId, otherGuest.userId);
      const peer = await client.query('select id from public.stored_value_ledger where id = $1', [ledgerId]);
      assert.equal(peer.rowCount, 0, 'a different guest at the same brand read someone else\'s balance');

      // Brand A's own staff (owner/manager/admin path) keep their read.
      await principal(client, 'brand_owner', brandA.brandId, randomUUID());
      const ownStaff = await client.query('select id from public.stored_value_ledger where id = $1', [ledgerId]);
      assert.deepEqual(ownStaff.rows.map((r) => r.id), [ledgerId], 'brand A staff must see brand A ledger rows');

      // Brand B staff: cross-tenant denial, the gap this file closes.
      await principal(client, 'staff', brandB.brandId, randomUUID());
      const crossBrand = await client.query('select id from public.stored_value_ledger where id = $1', [ledgerId]);
      assert.equal(crossBrand.rowCount, 0, 'brand B staff read brand A\'s stored-value ledger');
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });
});
