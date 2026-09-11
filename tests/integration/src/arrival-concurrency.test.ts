import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import type pg from 'pg';

import { databaseClient, stack } from './stack.ts';

async function beginCustomer(client: pg.Client, user: string, brand: string): Promise<void> {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({
    sub: user, role: 'authenticated', app_metadata: { brand_id: brand, role: 'customer' },
  })]);
  await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', user]);
}

async function arriveAndCommit(client: pg.Client, order: string): Promise<pg.QueryResult<{ arrived_at: Date }>> {
  try {
    const receipt = await client.query<{ arrived_at: Date }>(
      'select public.mark_order_arrived($1) arrived_at', [order],
    );
    // Release this caller's row lock before awaiting the other caller's receipt.
    await client.query('commit');
    return receipt;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

describe('curbside arrival concurrency', { skip: !stack.dbUrl }, () => {
  it('records one arrival when two authenticated requests overlap, and rejects another customer', async () => {
    const clients = [databaseClient(), databaseClient(), databaseClient()];
    const [control, first, second] = clients;
    assert.ok(control && first && second);
    const brand = randomUUID();
    const location = randomUUID();
    const user = randomUUID();
    const customer = randomUUID();
    const order = randomUUID();
    let pending: Promise<unknown>[] = [];
    await Promise.all(clients.map((client) => client.connect()));
    try {
      await control.query('insert into public.brands (id, slug, name) values ($1, $2, $2)',
        [brand, `arrival-${brand}`]);
      await control.query('insert into public.locations (id, brand_id, name) values ($1, $2, $3)',
        [location, brand, 'Arrival test']);
      await control.query('insert into auth.users (id, email) values ($1, $2)',
        [user, `${user}@integration.local`]);
      await control.query('insert into public.customers (id, brand_id, user_id) values ($1, $2, $3)',
        [customer, brand, user]);
      await control.query(`insert into public.orders
        (id, brand_id, location_id, customer_id, status, fulfillment_type)
        values ($1, $2, $3, $4, 'paid', 'curbside')`, [order, brand, location, customer]);
      const pids: number[] = [];
      for (const client of [first, second]) {
        // Pin each backend and its principal for transaction-pooling hosts too.
        await beginCustomer(client, user, brand);
        pids.push((await client.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!.pid);
      }
      await control.query('begin');
      await control.query('select id from public.orders where id = $1 for update', [order]);
      const calls = [first, second].map((client) => arriveAndCommit(client, order));
      pending = calls;
      const completed = Promise.all(calls);
      void completed.catch(() => undefined);
      let blocked = 0;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await control.query('select pg_stat_clear_snapshot()');
        const result = await control.query<{ count: string }>(`select count(*) from pg_stat_activity
          where pid = any($1::int[]) and wait_event_type = 'Lock'`, [pids]);
        blocked = Number(result.rows[0]!.count);
        if (blocked === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(blocked, 2, 'both requests must overlap while waiting for the order row');
      await control.query('commit');
      const receipts = (await completed).map((result) => result.rows[0]!.arrived_at.toISOString());
      assert.equal(receipts[0], receipts[1]);
      await beginCustomer(first, user, brand);
      const replay = await arriveAndCommit(first, order);
      assert.equal(replay.rows[0]!.arrived_at.toISOString(), receipts[0]);
      await beginCustomer(second, randomUUID(), brand);
      await assert.rejects(arriveAndCommit(second, order),
        /order not found, not curbside, or not arrivable/);
      for (const client of [first, second]) {
        const principal = await client.query<{ role: string; subject: string | null }>(
          `select current_user as role, current_setting('request.jwt.claim.sub', true) as subject`,
        );
        assert.notEqual(principal.rows[0]!.role, 'authenticated', 'caller role must end with transaction');
        assert.ok(!principal.rows[0]!.subject, 'caller claims must end with transaction');
      }
      const events = await control.query(`select snapshot from public.order_events
        where order_id = $1 and snapshot ? 'arrived_at'`, [order]);
      assert.equal(events.rowCount, 1);
      assert.equal(new Date(events.rows[0]!.snapshot.arrived_at).toISOString(), receipts[0]);
      const persisted = await control.query<{ arrived_at: Date }>(
        'select arrived_at from public.orders where id = $1', [order],
      );
      assert.equal(persisted.rows[0]!.arrived_at.toISOString(), receipts[0]);
    } finally {
      try {
        await control.query('rollback');
        await Promise.allSettled(pending);
        await Promise.all([first, second].map((client) => client.query('rollback')));
        // Remove orders while their location still exists for the board-signal trigger.
        await control.query('delete from public.orders where id = $1', [order]);
        await control.query('delete from public.brands where id = $1', [brand]);
        await control.query('delete from auth.users where id = $1', [user]);
      } finally {
        await Promise.all(clients.map((client) => client.end()));
      }
    }
  });
});
