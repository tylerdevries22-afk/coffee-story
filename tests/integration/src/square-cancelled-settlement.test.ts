import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { POST } from '../../../apps/hq/app/api/webhooks/square/route.ts';

import { seedBrand, skipUnlessConfigured, sql, stack } from './stack.ts';

const SIGNATURE_KEY = 'cancelled-settlement-key';
const WEBHOOK_URL = 'http://hq.test/api/webhooks/square';

describe('late Square settlement', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';

  before(async function setup() {
    if (skipUnlessConfigured) return;
    process.env.SUPABASE_URL = stack.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = SIGNATURE_KEY;
    process.env.SQUARE_WEBHOOK_URL = WEBHOOK_URL;
    ({ brandId, locationId } = await seedBrand('cancelled-settlement'));
  });

  it('leaves a payment delivery unresolved when its local order is cancelled', async () => {
    const squareOrderId = `SQ-${randomUUID()}`;
    const order = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, status, tender_type, total_cents, subtotal_cents, square_order_id)
       values ($1, $2, 'cancelled', 'square_link', 500, 500, $3) returning id`,
      [brandId, locationId, squareOrderId],
    );
    const eventId = `evt-${randomUUID()}`;
    const body = JSON.stringify({
      event_id: eventId,
      type: 'payment.updated',
      data: { object: { payment: {
        id: `PAY-${randomUUID()}`, status: 'COMPLETED', order_id: squareOrderId,
        total_money: { amount: 500, currency: 'USD' },
        app_fee_money: { amount: 15, currency: 'USD' },
      } } },
    });
    const signature = createHmac('sha256', SIGNATURE_KEY)
      .update(WEBHOOK_URL + body).digest('base64');
    const response = await POST(new Request(WEBHOOK_URL, {
      method: 'POST', body,
      headers: { 'x-square-hmacsha256-signature': signature },
    }));
    assert.equal(response.status, 409);

    const delivery = await sql<{ processed_at: string | null; error: string | null }>(
      `select processed_at, error from public.webhook_events where event_id = $1`, [eventId],
    );
    assert.equal(delivery.rows[0]!.processed_at, null);
    assert.match(delivery.rows[0]!.error ?? '', /order_event/);
    const events = await sql<{ count: string }>(
      `select count(*)::text as count from public.order_events where order_id = $1`,
      [order.rows[0]!.id],
    );
    assert.equal(events.rows[0]!.count, '0');
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
        total_money: { amount: 499, currency: 'USD' },
      } } },
    });
    const signature = createHmac('sha256', SIGNATURE_KEY)
      .update(WEBHOOK_URL + body).digest('base64');
    const response = await POST(new Request(WEBHOOK_URL, {
      method: 'POST', body,
      headers: { 'x-square-hmacsha256-signature': signature },
    }));
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
