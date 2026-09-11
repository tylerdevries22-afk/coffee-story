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
    await sql(`delete from public.platform_fee_quotes where order_id = any($1::uuid[])`,
      [orders.rows.map((order) => order.id)]);
  });

  it('releases an expired reservation only after its hosted link is disabled', async () => {
    const isolated = await seedBrand(`platform-fee-expiry-${randomUUID()}`);
    const orders = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, total_cents, subtotal_cents, tender_type, square_payment_link_id)
       values ($1, $2, 99000, 99000, 'square_link', $3),
              ($1, $2, 2000, 2000, 'square_link', $4),
              ($1, $2, 1000, 1000, 'square_link', $5) returning id`,
      [isolated.brandId, isolated.locationId, `link-${randomUUID()}`,
        `link-${randomUUID()}`, `link-${randomUUID()}`],
    );
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const quote = (orderId: string, chargeCents: number) =>
      serviceClient().rpc('claim_platform_fee_quote', {
        p_order_id: orderId, p_location_id: isolated.locationId, p_charge_cents: chargeCents,
        p_fee_bps: 300, p_fee_bps_tier2: 150, p_tier_threshold_cents: 100_000,
        p_month_start: monthStart.toISOString(), p_month_end: monthEnd.toISOString(),
      });

    assert.equal((await quote(orders.rows[0]!.id, 99_000)).error, null);
    await sql(`update public.platform_fee_quotes set expires_at = now() - interval '1 second'
               where order_id = $1`, [orders.rows[0]!.id]);
    const crossing = await quote(orders.rows[1]!.id, 2_000);
    assert.equal(crossing.error, null);
    assert.equal(Number((crossing.data as { quoted_fee_cents: number }[])[0]!.quoted_fee_cents), 45);

    const link = await sql<{ square_payment_link_id: string }>(
      `select square_payment_link_id from public.orders where id = $1`, [orders.rows[0]!.id],
    );
    const expired = await serviceClient().rpc('expire_square_checkout_quote', {
      p_order_id: orders.rows[0]!.id,
      p_payment_link_id: link.rows[0]!.square_payment_link_id,
    });
    assert.equal(expired.error, null);
    assert.equal(expired.data, true);

    const result = await quote(orders.rows[2]!.id, 1_000);
    assert.equal(result.error, null);
    assert.equal(Number((result.data as { quoted_fee_cents: number }[])[0]!.quoted_fee_cents), 30);
    const state = await sql<{ status: string; quotes: string; events: string }>(
      `select target.status,
              (select count(*)::text from public.platform_fee_quotes where order_id = target.id) as quotes,
              (select count(*)::text from public.order_events
                where order_id = target.id and type = 'cancelled' and source = 'job') as events
         from public.orders target where target.id = $1`,
      [orders.rows[0]!.id],
    );
    assert.deepEqual(state.rows[0], { status: 'cancelled', quotes: '0', events: '1' });
  });

  it('releases a rejected attempt but preserves a settled quote', async () => {
    const order = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, total_cents, subtotal_cents)
       values ($1, $2, 1000, 1000) returning id`, [brandId, locationId],
    );
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const quote = await serviceClient().rpc('claim_platform_fee_quote', {
      p_order_id: order.rows[0]!.id, p_location_id: locationId, p_charge_cents: 1_000,
      p_fee_bps: 300, p_fee_bps_tier2: 150, p_tier_threshold_cents: 100_000,
      p_month_start: monthStart.toISOString(), p_month_end: monthEnd.toISOString(),
    });
    assert.equal(quote.error, null);
    const firstGeneration = (quote.data as { quote_claim_generation: string }[])[0]!.quote_claim_generation;
    const renewed = await serviceClient().rpc('claim_platform_fee_quote', {
      p_order_id: order.rows[0]!.id, p_location_id: locationId, p_charge_cents: 1_000,
      p_fee_bps: 300, p_fee_bps_tier2: 150, p_tier_threshold_cents: 100_000,
      p_month_start: monthStart.toISOString(), p_month_end: monthEnd.toISOString(),
    });
    assert.equal(renewed.error, null);
    const renewedGeneration = (renewed.data as { quote_claim_generation: string }[])[0]!.quote_claim_generation;
    assert.notEqual(renewedGeneration, firstGeneration);
    const staleRelease = await serviceClient().rpc('release_platform_fee_quote', {
      p_order_id: order.rows[0]!.id, p_claim_generation: firstGeneration,
    });
    assert.equal(staleRelease.error, null);
    assert.equal(staleRelease.data, false);
    const released = await serviceClient().rpc('release_platform_fee_quote', {
      p_order_id: order.rows[0]!.id,
      p_claim_generation: renewedGeneration,
    });
    assert.equal(released.error, null);
    assert.equal(released.data, true);
    const saved = await sql<{ count: string }>(
      `select count(*)::text as count from public.platform_fee_quotes where order_id = $1`,
      [order.rows[0]!.id],
    );
    assert.equal(saved.rows[0]!.count, '0');

    const settledClaim = await serviceClient().rpc('claim_platform_fee_quote', {
      p_order_id: order.rows[0]!.id, p_location_id: locationId, p_charge_cents: 1_000,
      p_fee_bps: 300, p_fee_bps_tier2: 150, p_tier_threshold_cents: 100_000,
      p_month_start: monthStart.toISOString(), p_month_end: monthEnd.toISOString(),
    });
    assert.equal(settledClaim.error, null);
    const settledGeneration = (settledClaim.data as { quote_claim_generation: string }[])[0]!.quote_claim_generation;
    await sql(
      `insert into public.platform_fees
         (brand_id, location_id, order_id, gross_cents, fee_cents, fee_bps_applied, square_payment_id)
       values ($1, $2, $3, 1000, 30, 300, $4)`,
      [brandId, locationId, order.rows[0]!.id, `settled-${randomUUID()}`],
    );
    const settledLinkId = `link-${randomUUID()}`;
    await sql(
      `update public.orders set tender_type = 'square_link', square_payment_link_id = $2
         where id = $1`,
      [order.rows[0]!.id, settledLinkId],
    );
    await sql(
      `update public.platform_fee_quotes set expires_at = now() - interval '1 second'
         where order_id = $1`,
      [order.rows[0]!.id],
    );
    const settledRelease = await serviceClient().rpc('release_platform_fee_quote', {
      p_order_id: order.rows[0]!.id,
      p_claim_generation: settledGeneration,
    });
    assert.equal(settledRelease.error, null);
    assert.equal(settledRelease.data, false);
    const settledExpiry = await serviceClient().rpc('expire_square_checkout_quote', {
      p_order_id: order.rows[0]!.id,
      p_payment_link_id: settledLinkId,
    });
    assert.equal(settledExpiry.error, null);
    assert.equal(settledExpiry.data, false);
    const preserved = await sql<{ count: string }>(
      `select count(*)::text as count from public.platform_fee_quotes where order_id = $1`,
      [order.rows[0]!.id],
    );
    assert.equal(preserved.rows[0]!.count, '1');
  });
});
