import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { seedBrand, sql, stack } from './stack.ts';

/**
 * app.order_transition_allowed's allow-list, transcribed from
 * supabase/migrations/20260722000005_orders.sql:89-104 -- the edges the
 * trigger at :123-126 raises `illegal order transition % -> % for order %`
 * for anything outside of. Nothing in the suite ever inserted a disallowed
 * pair before this file: order-machine.test.ts's one "illegal transition"
 * test hits the separate operator-paid/cancelled guard
 * (20260908227000_repair_bounded_claims.sql:2617-2622), whose message differs
 * and which fires only for source='operator'.
 */
const ALLOWED: readonly (readonly [string, string])[] = [
  ['created', 'paid'], ['created', 'cancelled'],
  ['paid', 'in_progress'], ['paid', 'cancelled'], ['paid', 'refunded'],
  ['in_progress', 'ready'], ['in_progress', 'cancelled'], ['in_progress', 'refunded'],
  ['ready', 'picked_up'], ['ready', 'refunded'],
  ['picked_up', 'refunded'],
];

/**
 * A representative sample rather than all 31 disallowed ordered pairs: every
 * reverse of an allowed edge, a few forward skips, and the pairs named in the
 * coverage gap this file closes (refunded->paid, picked_up->in_progress,
 * cancelled->ready, ready->created, refunded->cancelled).
 */
const DISALLOWED: readonly (readonly [string, string])[] = [
  ['refunded', 'paid'], ['picked_up', 'in_progress'], ['cancelled', 'ready'],
  ['ready', 'created'], ['refunded', 'cancelled'],
  ['paid', 'created'], ['in_progress', 'paid'], ['ready', 'in_progress'],
  ['created', 'in_progress'], ['created', 'ready'], ['created', 'picked_up'],
  ['paid', 'ready'], ['in_progress', 'picked_up'], ['cancelled', 'paid'],
];

/** brands.slug forbids underscores; order_status values like 'in_progress' have them. */
function slugify(status: string): string {
  return status.replaceAll('_', '-');
}

/** source='system' so neither the operator- nor customer-only guards fire first. */
async function createOrder(brandId: string, locationId: string, status: string): Promise<string> {
  const row = await sql<{ id: string }>(
    `insert into public.orders (brand_id, location_id, status) values ($1, $2, $3::app.order_status) returning id`,
    [brandId, locationId, status],
  );
  return row.rows[0]!.id;
}

async function orderStatus(orderId: string): Promise<string> {
  const row = await sql<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
  return row.rows[0]!.status;
}

describe('order transition guard (app.order_transition_allowed)', { skip: !stack.dbUrl }, () => {
  for (const [from, to] of DISALLOWED) {
    it(`rejects ${from} -> ${to}`, async () => {
      const { brandId, locationId } = await seedBrand(`txn-bad-${slugify(from)}-${slugify(to)}`);
      const orderId = await createOrder(brandId, locationId, from);
      await assert.rejects(
        sql(
          `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, $3::app.order_status, 'system')`,
          [brandId, orderId, to],
        ),
        /illegal order transition/,
        `${from} -> ${to} must be rejected by the trigger`,
      );
      assert.equal(await orderStatus(orderId), from, `${from} -> ${to} must not move the order`);
    });
  }

  for (const [from, to] of ALLOWED) {
    it(`permits ${from} -> ${to}`, async () => {
      const { brandId, locationId } = await seedBrand(`txn-ok-${slugify(from)}-${slugify(to)}`);
      const orderId = await createOrder(brandId, locationId, from);
      await sql(
        `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, $3::app.order_status, 'system')`,
        [brandId, orderId, to],
      );
      assert.equal(await orderStatus(orderId), to, `${from} -> ${to} is on the allow-list and must succeed`);
    });
  }
});
