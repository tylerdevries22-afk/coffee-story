import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { seedBrand, skipUnlessConfigured, sql } from './stack.ts';

describe('atomic Square payment settlement', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';

  before(async function setup() {
    if (skipUnlessConfigured) return;
    ({ brandId, locationId } = await seedBrand('square-payment-settlement'));
  });

  async function createOrder(): Promise<{ orderId: string; squareOrderId: string }> {
    const squareOrderId = `order-${randomUUID()}`;
    const created = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, status, tender_type, subtotal_cents, total_cents,
          square_order_id)
       values ($1, $2, 'created', 'square_link', 1000, 1000, $3) returning id`,
      [brandId, locationId, squareOrderId],
    );
    const orderId = created.rows[0]!.id;
    await sql(
      `insert into public.platform_fee_quotes
         (order_id, brand_id, location_id, month_start, month_end, gross_cents,
          fee_cents, fee_bps_applied, expires_at)
       values ($1, $2, $3, date_trunc('month', now()),
         date_trunc('month', now()) + interval '1 month', 1000, 30, 300,
         now() + interval '1 hour')`,
      [orderId, brandId, locationId],
    );
    return { orderId, squareOrderId };
  }

  async function settle(
    orderId: string,
    squareOrderId: string,
    eventId: string,
    paymentId: string,
    feeCents = 30,
  ): Promise<boolean> {
    const result = await sql<{ recorded: boolean }>(
      `select public.record_square_payment_settlement($1, $2, $3, $4, $5, 'payment.updated')
         as recorded`,
      [orderId, eventId, squareOrderId, paymentId, feeCents],
    );
    return result.rows[0]!.recorded;
  }

  it('commits the payment identity, paid event, and fee receipt together', async () => {
    const { orderId, squareOrderId } = await createOrder();
    const eventId = `event-${randomUUID()}`;
    const paymentId = `payment-${randomUUID()}`;

    assert.equal(await settle(orderId, squareOrderId, eventId, paymentId), true);
    assert.equal(await settle(orderId, squareOrderId, eventId, paymentId), false,
      'the settlement is replayable');

    const state = await sql<{
      status: string;
      square_payment_id: string | null;
      events: string;
      fees: string;
    }>(
      `select target.status, target.square_payment_id,
              (select count(*) from public.order_events
                where order_id = target.id and square_event_id = $2)::text as events,
              (select count(*) from public.platform_fees
                where order_id = target.id and square_payment_id = $3)::text as fees
       from public.orders target where target.id = $1`,
      [orderId, eventId, paymentId],
    );
    assert.deepEqual(state.rows[0], {
      status: 'paid', square_payment_id: paymentId, events: '1', fees: '1',
    });
  });

  it('rejects conflicting payment identities without partial writes', async () => {
    const first = await createOrder();
    const second = await createOrder();
    const paymentId = `payment-${randomUUID()}`;
    await settle(first.orderId, first.squareOrderId, `event-${randomUUID()}`, paymentId);

    await assert.rejects(
      settle(first.orderId, first.squareOrderId, `event-${randomUUID()}`, `payment-${randomUUID()}`),
      /different Square payment/,
    );
    await assert.rejects(
      settle(second.orderId, second.squareOrderId, `event-${randomUUID()}`, paymentId),
      /different fee receipt/,
    );

    const untouched = await sql<{
      status: string;
      square_payment_id: string | null;
      events: string;
      fees: string;
    }>(
      `select target.status, target.square_payment_id,
              (select count(*) from public.order_events where order_id = target.id)::text as events,
              (select count(*) from public.platform_fees where order_id = target.id)::text as fees
       from public.orders target where target.id = $1`,
      [second.orderId],
    );
    assert.deepEqual(untouched.rows[0], {
      status: 'created', square_payment_id: null, events: '0', fees: '0',
    });
  });
});
