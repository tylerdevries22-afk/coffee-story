import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { POST } from '../../../apps/hq/app/api/webhooks/square/route.ts';

import { currentPeriod } from './platform-fee-test-support.ts';
import { exposeStackToRoutes, seedBrand, skipUnlessConfigured, sql } from './stack.ts';

const SIGNATURE_KEY = 'cancelled-settlement-key';
const WEBHOOK_URL = 'http://hq.test/api/webhooks/square';
const SQUARE_LOCATION_ID = 'SQ-CANCELLED-SETTLEMENT';

function signedRequest(body: string): Request {
  const signature = createHmac('sha256', SIGNATURE_KEY)
    .update(WEBHOOK_URL + body).digest('base64');
  return new Request(WEBHOOK_URL, {
    method: 'POST', body,
    headers: { 'x-square-hmacsha256-signature': signature },
  });
}

describe('late Square settlement', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';
  let connectionId = '';
  let connectionGeneration = '';

  before(async function setup() {
    if (skipUnlessConfigured) return;
    exposeStackToRoutes();
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = SIGNATURE_KEY;
    process.env.SQUARE_WEBHOOK_URL = WEBHOOK_URL;
    ({ brandId, locationId } = await seedBrand('cancelled-settlement'));
    const connection = await sql<{ id: string; connection_generation: string }>(
      `insert into public.square_connections
         (brand_id, location_id, merchant_id, square_location_id,
          access_token_encrypted, refresh_token_encrypted, expires_at,
          oauth_scope_contract_version)
       values ($1, $2, 'merchant', $3, 'ciphertext', 'ciphertext', now() + interval '1 day', 2)
       on conflict (location_id) do update
         set square_location_id = excluded.square_location_id,
             oauth_scope_contract_version = excluded.oauth_scope_contract_version
       returning id, connection_generation`,
      [brandId, locationId, SQUARE_LOCATION_ID],
    );
    connectionId = connection.rows[0]!.id;
    connectionGeneration = connection.rows[0]!.connection_generation;
  });

  it('records and queues a full refund when Square settles after terminal cancellation', async () => {
    const squareOrderId = `SQ-${randomUUID()}`;
    const order = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, status, tender_type, total_cents, subtotal_cents, square_order_id)
       values ($1, $2, 'created', 'square_card', 1000, 1000, $3) returning id`,
      [brandId, locationId, squareOrderId],
    );
    const orderId = order.rows[0]!.id;
    const period = await currentPeriod(locationId);
    await sql(
      `select * from public.claim_platform_fee_quote(
         $1, $2, 1000, 200, 150, 2500000,
         $5::timestamptz, $6::timestamptz,
         $3, $4, false)`,
      [orderId, locationId, connectionId, connectionGeneration,
        period.monthStart, period.monthEnd],
    );
    await sql(`update public.platform_fee_quotes set expires_at = now() - interval '1 hour'
      where order_id = $1`, [orderId]);
    const cleanup = await sql<{ claim_generation: string }>(
      `select claim_generation from public.claim_due_square_card_quotes(now(), 50)
       where order_id = $1`, [orderId],
    );
    assert.equal(cleanup.rows.length, 1);
    const expired = await sql<{ expired: boolean }>(
      `select public.expire_square_card_quote($1, $2, $3, 7, 'CANCELED', null, null) as expired`,
      [orderId, cleanup.rows[0]!.claim_generation, squareOrderId],
    );
    assert.equal(expired.rows[0]!.expired, true);
    const eventId = `evt-${randomUUID()}`;
    const paymentId = `PAY-${randomUUID()}`;
    const body = JSON.stringify({
      event_id: eventId,
      type: 'payment.updated',
      data: { object: { payment: {
        id: paymentId, status: 'COMPLETED', order_id: squareOrderId,
        location_id: SQUARE_LOCATION_ID,
        total_money: { amount: 1000, currency: 'USD' },
        app_fee_money: { amount: 20, currency: 'USD' },
      } } },
    });
    const response = await POST(signedRequest(body));
    assert.equal(response.status, 200);

    const delivery = await sql<{ processed_at: string | null; error: string | null }>(
      `select processed_at, error from public.webhook_events where event_id = $1`, [eventId],
    );
    assert.ok(delivery.rows[0]!.processed_at);
    assert.equal(delivery.rows[0]!.error, null);
    const state = await sql<{ status: string; square_payment_id: string; fees: string; late_events: string }>(
      `select orders.status, orders.square_payment_id,
         (select count(*) from public.platform_fees where order_id = orders.id)::text as fees,
         (select count(*) from public.order_events where order_id = orders.id
            and square_event_id = $2 and snapshot->>'late_settlement_after_cancellation' = 'true')::text as late_events
       from public.orders where orders.id = $1`,
      [orderId, eventId],
    );
    assert.deepEqual(state.rows[0], {
      status: 'cancelled', square_payment_id: paymentId, fees: '1', late_events: '1',
    });
    const remediation = await sql<{ count: string }>(
      `select count(*)::text as count from app_private.square_payment_remediation_outbox
       where order_id = $1`,
      [orderId],
    );
    assert.equal(remediation.rows[0]!.count, '1');
  });

  it('rejects an underpaid provider receipt without settling the order', async () => {
    const squareOrderId = `SQ-${randomUUID()}`;
    const order = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, status, tender_type, total_cents, subtotal_cents, square_order_id)
       values ($1, $2, 'created', 'square_link', 500, 500, $3) returning id`,
      [brandId, locationId, squareOrderId],
    );
    const body = JSON.stringify({
      event_id: `evt-${randomUUID()}`, type: 'payment.updated',
      data: { object: { payment: {
        id: `PAY-${randomUUID()}`, status: 'COMPLETED', order_id: squareOrderId,
        location_id: SQUARE_LOCATION_ID,
        total_money: { amount: 499, currency: 'USD' },
      } } },
    });
    const response = await POST(signedRequest(body));
    assert.equal(response.status, 422);

    const unchanged = await sql<{ status: string; square_payment_id: string | null }>(
      `select status, square_payment_id from public.orders where id = $1`, [order.rows[0]!.id],
    );
    assert.deepEqual(unchanged.rows[0], { status: 'created', square_payment_id: null });
    const sideEffects = await sql<{ events: string; fees: string }>(
      `select
         (select count(*) from public.order_events where order_id = $1)::text as events,
         (select count(*) from public.platform_fees where order_id = $1)::text as fees`,
      [order.rows[0]!.id],
    );
    assert.deepEqual(sideEffects.rows[0], { events: '0', fees: '0' });
  });
});
