import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import {
  currentPeriod,
  type QuoteRow,
  seedSquareConnection,
  squareConnectionSnapshot,
} from './platform-fee-test-support.ts';
import { seedBrand, serviceClient, skipUnlessConfigured, sql } from './stack.ts';

describe('platform fee quote serialization', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';

  before(async function setup() {
    if (skipUnlessConfigured) return;
    ({ brandId, locationId } = await seedBrand('platform-fee-quote'));
    await seedSquareConnection(brandId, locationId);
    await sql(`update public.brands set fee_bps = 300, fee_bps_tier2 = 150,
      tier_threshold_cents = 100000 where id = $1`, [brandId]);
  });

  async function claim(
    orderId: string,
    targetLocation = locationId,
    chargeCents = 1_000,
  ): Promise<QuoteRow> {
    const period = await currentPeriod(targetLocation);
    const connection = await squareConnectionSnapshot(targetLocation);
    const result = await serviceClient().rpc('claim_platform_fee_quote', {
      p_order_id: orderId,
      p_location_id: targetLocation,
      p_charge_cents: chargeCents,
      p_fee_bps: 300,
      p_fee_bps_tier2: 150,
      p_tier_threshold_cents: 100_000,
      p_month_start: period.monthStart,
      p_month_end: period.monthEnd,
      p_connection_id: connection.id,
      p_connection_generation: connection.connection_generation,
    });
    assert.equal(result.error, null);
    return (result.data as QuoteRow[])[0]!;
  }

  it('serializes monthly volume and makes live replay read-only', async () => {
    const prior = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, tender_type, subtotal_cents, total_cents)
       values ($1, $2, 'square_card', 99000, 99000) returning id`,
      [brandId, locationId],
    );
    await sql(
      `insert into public.platform_fees
         (brand_id, location_id, order_id, gross_cents, fee_cents,
          fee_bps_applied, square_payment_id)
       values ($1, $2, $3, 99000, 2970, 300, $4)`,
      [brandId, locationId, prior.rows[0]!.id, `prior-${randomUUID()}`],
    );
    const orders = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, tender_type, subtotal_cents, total_cents)
       values ($1, $2, 'square_card', 1000, 1000),
              ($1, $2, 'square_card', 1000, 1000) returning id`,
      [brandId, locationId],
    );
    const initial = await Promise.all(orders.rows.map((order) => claim(order.id)));
    assert.deepEqual(initial.map((row) => Number(row.quoted_fee_cents)).sort(), [15, 30]);
    assert.ok(initial.every((row) => row.quote_claim_created && row.quote_claim_generation));

    const firstOrder = orders.rows[0]!.id;
    const before = await sql<{ claim_generation: string; expires_at: string }>(
      `select claim_generation, expires_at::text from public.platform_fee_quotes where order_id = $1`,
      [firstOrder],
    );
    const replay = await claim(firstOrder);
    const after = await sql<{ claim_generation: string; expires_at: string }>(
      `select claim_generation, expires_at::text from public.platform_fee_quotes where order_id = $1`,
      [firstOrder],
    );
    assert.equal(replay.quote_claim_created, false);
    assert.equal(replay.quote_claim_generation, null);
    assert.deepEqual(after.rows[0], before.rows[0]);
  });

  it('expires hosted checkout only with a leased terminal provider proof', async () => {
    const isolated = await seedBrand(`platform-fee-expiry-${randomUUID()}`);
    await seedSquareConnection(isolated.brandId, isolated.locationId);
    await sql(`update public.brands set fee_bps = 300, fee_bps_tier2 = 150,
      tier_threshold_cents = 100000 where id = $1`, [isolated.brandId]);
    const created = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, tender_type, subtotal_cents, total_cents)
       values ($1, $2, 'square_link', 2000, 2000) returning id`,
      [isolated.brandId, isolated.locationId],
    );
    const orderId = created.rows[0]!.id;
    const quote = await claim(orderId, isolated.locationId, 2_000);
    const linkId = `link-${randomUUID()}`;
    const squareOrderId = `order-${randomUUID()}`;
    const bound = await serviceClient().rpc('bind_square_checkout_link', {
      p_order_id: orderId,
      p_claim_generation: quote.quote_claim_generation,
      p_checkout_url: `https://checkout.example/${linkId}`,
      p_payment_link_id: linkId,
      p_square_order_id: squareOrderId,
    });
    assert.equal(bound.error, null);
    assert.equal(bound.data, true);
    await sql(`update public.platform_fee_quotes set expires_at = now() - interval '1 second'
      where order_id = $1`, [orderId]);
    const claimed = await serviceClient().rpc('claim_due_square_checkout_quotes', {
      p_now: new Date().toISOString(), p_limit: 50,
    });
    assert.equal(claimed.error, null);
    const cleanup = (claimed.data as Array<{ claim_generation: string; order_id: string }>)
      .find((row) => row.order_id === orderId)!;
    const expired = await serviceClient().rpc('expire_square_checkout_quote', {
      p_order_id: orderId,
      p_claim_generation: cleanup.claim_generation,
      p_payment_link_id: linkId,
      p_square_order_id: squareOrderId,
      p_provider_order_version: 7,
      p_provider_order_state: 'CANCELED',
    });
    assert.equal(expired.error, null);
    assert.equal(expired.data, true);
    const state = await sql<{ events: string; evidence: string; quotes: string; status: string }>(
      `select target.status,
        (select count(*)::text from public.platform_fee_quotes where order_id = target.id) quotes,
        (select count(*)::text from public.order_events
          where order_id = target.id and type = 'cancelled' and source = 'job') events,
        (select count(*)::text from app_private.square_attempt_terminal_evidence
          where order_id = target.id and provider_order_state = 'CANCELED') evidence
       from public.orders target where target.id = $1`,
      [orderId],
    );
    assert.deepEqual(state.rows[0], { status: 'cancelled', quotes: '0', events: '1', evidence: '1' });
  });

  it('removes a reservation only after exact durable settlement', async () => {
    const squareOrderId = `order-${randomUUID()}`;
    const created = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, tender_type, subtotal_cents, total_cents, square_order_id)
       values ($1, $2, 'square_card', 1000, 1000, $3) returning id`,
      [brandId, locationId, squareOrderId],
    );
    const orderId = created.rows[0]!.id;
    const quote = await claim(orderId);
    const settled = await serviceClient().rpc('record_square_payment_settlement', {
      target_order: orderId,
      square_event: `event-${randomUUID()}`,
      square_order: squareOrderId,
      square_payment: `payment-${randomUUID()}`,
      settled_fee_cents: quote.quoted_fee_cents,
      square_event_type: 'payment.updated',
    });
    assert.equal(settled.error, null);
    assert.equal(settled.data, true);
    const state = await sql<{ quotes: string; status: string }>(
      `select status, (select count(*)::text from public.platform_fee_quotes
        where order_id = $1) quotes from public.orders where id = $1`, [orderId],
    );
    assert.deepEqual(state.rows[0], { status: 'paid', quotes: '0' });
    const release = await serviceClient().rpc('release_platform_fee_quote', {
      p_order_id: orderId, p_claim_generation: quote.quote_claim_generation,
    });
    assert.equal(release.error, null);
    assert.equal(release.data, false);
  });
});
