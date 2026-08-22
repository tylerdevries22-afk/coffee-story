import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { POST as cancelPost } from '../../../apps/hq/app/api/orders/cancel/route.ts';
import { POST as ordersPost } from '../../../apps/hq/app/api/orders/route.ts';

import { createSignedInUser, seedBrand, skipUnlessConfigured, sql, stack } from './stack.ts';

/**
 * A guest calling off their own order.
 *
 * The state machine has always allowed created/paid -> cancelled and the
 * event table has always allowed a 'customer' source; until now nothing wrote
 * one, so a guest who ordered by mistake left a drink ticket nobody would
 * collect. These tests pin both halves: that it works before the shop starts,
 * and that it is refused — for the right reasons — after.
 */

process.env.SUPABASE_URL = stack.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;

const SLUG = 'order-cancel';

function post(handler: (request: Request) => Promise<Response>, path: string, options: {
  token?: string;
  idempotencyKey?: string;
  body?: unknown;
}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  return handler(new Request(`http://hq.test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body ?? {}),
  }));
}

describe('a guest cancels their own order', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';
  let guestToken = '';
  let otherToken = '';

  before(async function setup() {
    if (skipUnlessConfigured) return;
    ({ brandId, locationId } = await seedBrand(SLUG));
    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published) values ($1, 'Menu', true) returning id`,
      [brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, title, sort_order) values ($1, $2, 'Drinks', 1) returning id`,
      [brandId, menu.rows[0]!.id],
    );
    await sql(
      `insert into public.menu_items (brand_id, menu_id, category_id, slug, name, base_price_cents, sizes, modifiers, sort_order)
       values ($1, $2, $3, 'drip', 'Drip Coffee', 400, '[]'::jsonb, '[]'::jsonb, 1)`,
      [brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );
    guestToken = (await createSignedInUser({ userMetadata: { brand_slug: SLUG } })).accessToken;
    otherToken = (await createSignedInUser({ userMetadata: { brand_slug: SLUG } })).accessToken;
  });

  async function placeOrder(token: string): Promise<string> {
    const response = await post(ordersPost, '/api/orders', {
      token,
      idempotencyKey: randomUUID(),
      body: {
        locationId,
        fulfillmentType: 'pickup',
        lines: [{ itemSlug: 'drip', quantity: 1 }],
        tipCents: 0,
        tenderType: 'pay_at_pickup',
      },
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as { orderId: string }).orderId;
  }

  it('cancels a pay-at-pickup order the shop has not started', async () => {
    const orderId = await placeOrder(guestToken);
    const response = await post(cancelPost, '/api/orders/cancel', {
      token: guestToken,
      body: { orderId, reason: 'Changed my mind' },
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { status: string; alreadyCancelled: boolean };
    assert.equal(body.status, 'cancelled');
    assert.equal(body.alreadyCancelled, false);

    const row = await sql<{ status: string }>('select status from public.orders where id = $1', [orderId]);
    assert.equal(row.rows[0]!.status, 'cancelled', 'the event moved the order');
    const event = await sql<{ source: string; snapshot: { reason: string } }>(
      `select source, snapshot from public.order_events where order_id = $1 and type = 'cancelled'`,
      [orderId],
    );
    assert.equal(event.rows[0]!.source, 'customer', 'recorded as the guest’s own doing');
    assert.equal(event.rows[0]!.snapshot.reason, 'Changed my mind');
  });

  it('answers a repeat cancellation without writing a second event', async () => {
    const orderId = await placeOrder(guestToken);
    await post(cancelPost, '/api/orders/cancel', { token: guestToken, body: { orderId } });
    const again = await post(cancelPost, '/api/orders/cancel', { token: guestToken, body: { orderId } });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { alreadyCancelled: boolean }).alreadyCancelled, true);
    const events = await sql<{ count: string }>(
      `select count(*)::text as count from public.order_events where order_id = $1 and type = 'cancelled'`,
      [orderId],
    );
    assert.equal(events.rows[0]!.count, '1');
  });

  it('refuses once the barista has started the drink', async () => {
    const orderId = await placeOrder(guestToken);
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'in_progress', 'operator')`,
      [brandId, orderId],
    );
    const response = await post(cancelPost, '/api/orders/cancel', { token: guestToken, body: { orderId } });
    assert.equal(response.status, 409);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'cancel_unavailable');
    assert.match(body.error.message, /already started/);
    const row = await sql<{ status: string }>('select status from public.orders where id = $1', [orderId]);
    assert.equal(row.rows[0]!.status, 'in_progress', 'the order is untouched');
  });

  it('never cancels an order belonging to someone else', async () => {
    const orderId = await placeOrder(guestToken);
    const response = await post(cancelPost, '/api/orders/cancel', { token: otherToken, body: { orderId } });
    // Same answer as a nonexistent order: no probing which ids are real.
    assert.equal(response.status, 404);
    const row = await sql<{ status: string }>('select status from public.orders where id = $1', [orderId]);
    assert.equal(row.rows[0]!.status, 'paid', 'the owner’s order is untouched');
  });

  it('requires a bearer token', async () => {
    const response = await post(cancelPost, '/api/orders/cancel', { body: { orderId: randomUUID() } });
    assert.equal(response.status, 401);
  });
});
