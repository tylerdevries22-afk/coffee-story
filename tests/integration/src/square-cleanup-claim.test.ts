import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { anonClient, seedBrand, serviceClient, skipUnlessConfigured, sql } from './stack.ts';

type ClaimedQuote = { order_id: string };

describe('Square checkout cleanup claims', { skip: skipUnlessConfigured }, () => {
  let orderIds: string[] = [];
  const now = new Date('2026-09-08T15:30:00.000Z');

  before(async function setup() {
    if (skipUnlessConfigured) return;
    const tenant = await seedBrand(`square-cleanup-claim-${randomUUID()}`);
    const orders = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, total_cents, subtotal_cents, tender_type,
          square_payment_link_id, square_order_id)
       values ($1, $2, 1000, 1000, 'square_link', $3, $4),
              ($1, $2, 1000, 1000, 'square_link', $5, $6),
              ($1, $2, 1000, 1000, 'square_link', $7, $8) returning id`,
      [tenant.brandId, tenant.locationId,
        `link-${randomUUID()}`, `order-${randomUUID()}`,
        `link-${randomUUID()}`, `order-${randomUUID()}`,
        `link-${randomUUID()}`, `order-${randomUUID()}`],
    );
    orderIds = orders.rows.map((row) => row.id);
    await sql(
      `insert into public.platform_fee_quotes
         (order_id, brand_id, location_id, month_start, month_end, gross_cents,
          fee_cents, fee_bps_applied, expires_at, cleanup_claimed_at)
       values ($1, $4, $5, $6, $7, 1000, 30, 300, $8, null),
              ($2, $4, $5, $6, $7, 1000, 30, 300, $8, $9),
              ($3, $4, $5, $6, $7, 1000, 30, 300, $8, $6)`,
      [orderIds[0], orderIds[1], orderIds[2], tenant.brandId, tenant.locationId,
        now.toISOString(), '2026-10-01T00:00:00.000Z', '2026-09-08T14:00:00.000Z',
        '2026-09-08T15:20:00.000Z'],
    );
  });

  it('leases untried and least-recently-tried rows without an immediate replay', async () => {
    const claimed = await serviceClient().rpc('claim_due_square_checkout_quotes', {
      p_now: now.toISOString(), p_limit: 2,
    });
    assert.equal(claimed.error, null);
    const ids = ((claimed.data ?? []) as ClaimedQuote[]).map((row) => row.order_id);
    assert.equal(ids.length, 2);
    assert.ok(ids.includes(orderIds[0]!));
    assert.ok(ids.includes(orderIds[1]!));
    assert.ok(!ids.includes(orderIds[2]!));

    const replay = await serviceClient().rpc('claim_due_square_checkout_quotes', {
      p_now: now.toISOString(), p_limit: 50,
    });
    assert.equal(replay.error, null);
    assert.deepEqual(replay.data, []);
  });

  it('makes every lease eligible again after one cron interval', async () => {
    const next = await serviceClient().rpc('claim_due_square_checkout_quotes', {
      p_now: new Date(now.getTime() + 5 * 60_000).toISOString(), p_limit: 50,
    });
    assert.equal(next.error, null);
    assert.deepEqual(new Set(((next.data ?? []) as ClaimedQuote[]).map((row) => row.order_id)),
      new Set(orderIds));
  });

  it('keeps the claim RPC service-only and rejects oversized batches', async () => {
    const denied = await anonClient().rpc('claim_due_square_checkout_quotes', {
      p_now: now.toISOString(), p_limit: 1,
    });
    assert.ok(denied.error);
    const oversized = await serviceClient().rpc('claim_due_square_checkout_quotes', {
      p_now: now.toISOString(), p_limit: 51,
    });
    assert.ok(oversized.error);
  });
});
