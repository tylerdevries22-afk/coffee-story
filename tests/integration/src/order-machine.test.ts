import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { seedBrand, skipUnlessConfigured, sql } from './stack.ts';

async function createOrder(brandId: string, locationId: string, status = 'created'): Promise<string> {
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

/** The state machine, exercised in SQL — the trigger is the implementation. */
describe('order state machine (SQL trigger)', { skip: skipUnlessConfigured }, () => {
  it('walks the happy path and projects each event onto orders.status', async () => {
    const { brandId, locationId } = await seedBrand('machine-happy');
    const orderId = await createOrder(brandId, locationId);
    for (const next of ['paid', 'in_progress', 'ready', 'picked_up']) {
      await sql(
        `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, $3::app.order_status, 'system')`,
        [brandId, orderId, next],
      );
      assert.equal(await orderStatus(orderId), next);
    }
  });

  it('rejects operator payment after the unpaid collection edge has passed', async () => {
    const { brandId, locationId } = await seedBrand('machine-illegal');
    const orderId = await createOrder(brandId, locationId, 'in_progress');
    await assert.rejects(
      sql(
        `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'paid', 'operator')`,
        [brandId, orderId],
      ),
      /operator paid\/cancelled requires an unpaid pay-at-pickup order/,
    );
    assert.equal(await orderStatus(orderId), 'in_progress');
  });

  it('records a same-status re-assertion without moving anything', async () => {
    const { brandId, locationId } = await seedBrand('machine-same');
    const orderId = await createOrder(brandId, locationId, 'paid');
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source, square_event_id)
       values ($1, $2, 'paid', 'webhook', $3)`,
      [brandId, orderId, `evt-${randomUUID()}`],
    );
    assert.equal(await orderStatus(orderId), 'paid');
    const events = await sql(`select 1 from public.order_events where order_id = $1`, [orderId]);
    assert.equal(events.rowCount, 1, 'the re-assertion is recorded');
  });

  it('silently drops a replayed square_event_id even after the order moved on (0011 fix)', async () => {
    const { brandId, locationId } = await seedBrand('machine-replay');
    const orderId = await createOrder(brandId, locationId);
    const eventId = `evt-${randomUUID()}`;
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source, square_event_id)
       values ($1, $2, 'paid', 'webhook', $3)`,
      [brandId, orderId, eventId],
    );
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'in_progress', 'operator')`,
      [brandId, orderId],
    );
    // The replay: same square_event_id, now-illegal transition. Must succeed
    // as a no-op instead of raising (the 409-retry-loop bug).
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source, square_event_id)
       values ($1, $2, 'paid', 'webhook', $3)`,
      [brandId, orderId, eventId],
    );
    assert.equal(await orderStatus(orderId), 'in_progress', 'replay moved nothing');
    const count = await sql(
      `select 1 from public.order_events where square_event_id = $1`,
      [eventId],
    );
    assert.equal(count.rowCount, 1, 'no duplicate event row');
  });

  it('swallows a stale webhook transition and logs it to webhook_events (0011 fix)', async () => {
    const { brandId, locationId } = await seedBrand('machine-stale');
    const orderId = await createOrder(brandId, locationId, 'in_progress');
    const eventId = `evt-${randomUUID()}`;
    // A fresh event id asserting a state the order has left: swallowed, logged.
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source, square_event_id)
       values ($1, $2, 'paid', 'webhook', $3)`,
      [brandId, orderId, eventId],
    );
    assert.equal(await orderStatus(orderId), 'in_progress');
    const logged = await sql<{ error: string }>(
      `select error from public.webhook_events where event_id = $1`,
      [eventId],
    );
    assert.equal(logged.rowCount, 1, 'stale delivery is in the log');
    assert.match(logged.rows[0]!.error, /stale transition/);
  });

  it('enforces one order per (brand, client_key) — the double-charge guard (0012)', async () => {
    const { brandId, locationId } = await seedBrand('machine-idem');
    const clientKey = randomUUID();
    await sql(
      `insert into public.orders (brand_id, location_id, client_key) values ($1, $2, $3)`,
      [brandId, locationId, clientKey],
    );
    await assert.rejects(
      sql(
        `insert into public.orders (brand_id, location_id, client_key) values ($1, $2, $3)`,
        [brandId, locationId, clientKey],
      ),
      /duplicate key/,
    );
  });

  it('realtime publishes order projections and narrow invalidation signals, not private events', async () => {
    const published = await sql<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`,
    );
    const names = published.rows.map((row) => row.tablename);
    assert.ok(names.includes('orders'), 'orders published');
    assert.ok(names.includes('board_change_signals'), 'board invalidations published');
    assert.ok(names.includes('location_setting_signals'), 'location invalidations published');
    assert.ok(!names.includes('order_events'), 'private order events are not published');
  });
});
