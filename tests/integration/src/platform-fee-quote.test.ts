import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { seedBrand, serviceClient, skipUnlessConfigured, sql } from './stack.ts';

describe('platform fee quote serialization', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';

  before(async function setup() {
    if (skipUnlessConfigured) return;
    ({ brandId, locationId } = await seedBrand('platform-fee-quote'));
  });

  it('gives only one concurrent charge the remaining base-rate volume', async () => {
    const prior = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, total_cents, subtotal_cents)
       values ($1, $2, 99000, 99000) returning id`,
      [brandId, locationId],
    );
    await sql(
      `insert into public.platform_fees
         (brand_id, location_id, order_id, gross_cents, fee_cents, fee_bps_applied, square_payment_id)
       values ($1, $2, $3, 99000, 2970, 300, $4)`,
      [brandId, locationId, prior.rows[0]!.id, `prior-${randomUUID()}`],
    );
    const orders = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, total_cents, subtotal_cents)
       values ($1, $2, 1000, 1000), ($1, $2, 1000, 1000) returning id`,
      [brandId, locationId],
    );
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const quote = (orderId: string) => serviceClient().rpc('claim_platform_fee_quote', {
      p_order_id: orderId,
      p_location_id: locationId,
      p_charge_cents: 1_000,
      p_fee_bps: 300,
      p_fee_bps_tier2: 150,
      p_tier_threshold_cents: 100_000,
      p_month_start: monthStart.toISOString(),
      p_month_end: monthEnd.toISOString(),
    });

    const results = await Promise.all(orders.rows.map((order) => quote(order.id)));
    for (const result of results) assert.equal(result.error, null);
    const fees = results.flatMap((result) => (result.data ?? []) as { quoted_fee_cents: number }[])
      .map((row) => Number(row.quoted_fee_cents)).sort((a, b) => a - b);
    assert.deepEqual(fees, [15, 30]);

    const replay = await quote(orders.rows[0]!.id);
    assert.equal(replay.error, null);
    assert.equal(Number((replay.data as { quoted_fee_cents: number }[])[0]!.quoted_fee_cents),
      Number(((results[0]!.data ?? []) as { quoted_fee_cents: number }[])[0]!.quoted_fee_cents));
    const saved = await sql<{ count: string }>(
      `select count(*)::text as count from public.platform_fee_quotes where order_id = any($1::uuid[])`,
      [orders.rows.map((order) => order.id)],
    );
    assert.equal(saved.rows[0]!.count, '2');
  });
});
