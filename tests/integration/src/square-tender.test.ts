import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

import { encryptToken } from '../../../packages/engine/src/crypto.ts';

import { createSignedInUser, seedBrand, skipUnlessConfigured, sql, stack } from './stack.ts';

/**
 * The card tender, end to end, against a stand-in Square.
 *
 * Square itself is a local HTTP server here — not a stubbed function — so the
 * request bodies the platform actually sends are asserted: the app fee rule 3
 * demands, the reference id that ties a payment back to an order, and the
 * idempotency keys that stop a retried checkout from charging twice. What is
 * mocked is the merchant, never our own code path.
 */

process.env.SUPABASE_URL = stack.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
process.env.SQUARE_APP_ID = 'test-app-id';
process.env.SQUARE_APP_SECRET = 'test-app-secret';
// 32 bytes, base64: the key square_connections rows are sealed with.
const TOKEN_KEY = randomBytes(32);
process.env.SQUARE_TOKEN_KEY = TOKEN_KEY.toString('base64');

const SLUG = 'square-tender';
const MERCHANT_TOKEN = 'sq0atp-test-merchant-token';
const SQUARE_LOCATION_ID = 'SQ-LOC-1';
const WEBHOOK_KEY = 'square-webhook-test-key';
const WEBHOOK_URL = 'http://hq.test/api/webhooks/square';

process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = WEBHOOK_KEY;
process.env.SQUARE_WEBHOOK_URL = WEBHOOK_URL;

type Captured = { path: string; body: Record<string, unknown>; authorization: string | undefined };

const captured: Captured[] = [];
let squareServer: http.Server;
let squareBase = '';

/** A Square that answers the four shapes the platform asks for. */
function startFakeSquare(): Promise<void> {
  squareServer = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      captured.push({
        path: request.url ?? '',
        body,
        authorization: request.headers.authorization,
      });
      const reply = (payload: unknown, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      if (request.url === '/v2/online-checkout/payment-links') {
        reply({
          payment_link: {
            id: 'LINK-1',
            order_id: 'SQ-ORDER-1',
            url: 'https://square.link/u/test-checkout',
          },
        });
        return;
      }
      if (request.url === '/v2/refunds') {
        const amount = (body.amount_money as { amount?: number } | undefined)?.amount ?? 0;
        reply({ refund: { id: `REFUND-${amount}`, status: 'PENDING' } });
        return;
      }
      reply({ errors: [{ detail: `unexpected ${request.url}` }] }, 404);
    });
  });
  return new Promise((resolve) => {
    squareServer.listen(0, '127.0.0.1', () => {
      const address = squareServer.address();
      squareBase = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : '';
      process.env.SQUARE_API_BASE = squareBase;
      resolve();
    });
  });
}

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

function postSquareWebhook(
  handler: (request: Request) => Promise<Response>,
  payload: Record<string, unknown>,
): Promise<Response> {
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', WEBHOOK_KEY).update(WEBHOOK_URL + body).digest('base64');
  return handler(new Request(WEBHOOK_URL, {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', 'x-square-hmacsha256-signature': signature },
  }));
}

describe('square_link tender and refunds', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';
  let guestToken = '';
  let staffToken = '';
  let ordersPost: (request: Request) => Promise<Response>;
  let refundPost: (request: Request) => Promise<Response>;
  let webhookPost: (request: Request) => Promise<Response>;

  before(async function setup() {
    if (skipUnlessConfigured) return;
    await startFakeSquare();
    // Imported after the env is set: the routes read it per request, but the
    // engine's config helpers are happier with the values already in place.
    ({ POST: ordersPost } = await import('../../../apps/hq/app/api/orders/route.ts'));
    ({ POST: refundPost } = await import('../../../apps/hq/app/api/orders/refund/route.ts'));
    ({ POST: webhookPost } = await import('../../../apps/hq/app/api/webhooks/square/route.ts'));

    ({ brandId, locationId } = await seedBrand(SLUG));
    await sql(
      `update public.brands set fee_bps = 300, fee_bps_tier2 = 150, tier_threshold_cents = 2000000,
              brand_config = $2 where id = $1`,
      [brandId, JSON.stringify({
        identity: { slug: SLUG, scheme: 'coffeestory' },
        tax: { jurisdictions: [{ id: 'city', label: 'City Sales Tax', rate: 0.05 }] },
      })],
    );
    const menu = await sql<{ id: string }>(
      `insert into public.menus (brand_id, name, is_published) values ($1, 'Menu', true) returning id`,
      [brandId],
    );
    const category = await sql<{ id: string }>(
      `insert into public.menu_categories (brand_id, menu_id, slug, title, sort_order)
       values ($1, $2, 'drinks', 'Drinks', 1) returning id`,
      [brandId, menu.rows[0]!.id],
    );
    await sql(
      `insert into public.menu_items (brand_id, menu_id, category_id, slug, name, base_price_cents, sizes, modifiers, sort_order)
       values ($1, $2, $3, 'drip', 'Drip Coffee', 400, '[]'::jsonb, '[]'::jsonb, 1)`,
      [brandId, menu.rows[0]!.id, category.rows[0]!.id],
    );

    const guest = await createSignedInUser({ userMetadata: { brand_slug: SLUG } });
    guestToken = guest.accessToken;
    const staff = await createSignedInUser({
      userMetadata: { brand_slug: SLUG },
      before: async (userId) => {
        await sql(
          `insert into public.brand_users (user_id, brand_id, role, location_ids) values ($1, $2, 'brand_owner', '{}')`,
          [userId, brandId],
        );
      },
    });
    staffToken = staff.accessToken;
  });

  after(() => {
    squareServer?.close();
  });

  const orderBody = (extra: Record<string, unknown> = {}) => ({
    locationId,
    fulfillmentType: 'pickup',
    lines: [{ itemSlug: 'drip', quantity: 1 }],
    tipCents: 0,
    tenderType: 'square_link',
    ...extra,
  });

  it('refuses the card tender until the location is actually connected', async () => {
    const response = await post(ordersPost, '/api/orders', {
      token: guestToken,
      idempotencyKey: randomUUID(),
      body: orderBody(),
    });
    assert.equal(response.status, 503);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'tender_unavailable');
    // Nothing was written: an unpayable order must never reach the board.
    const orders = await sql<{ count: string }>(
      `select count(*)::text as count from public.orders where brand_id = $1`, [brandId]);
    assert.equal(orders.rows[0]!.count, '0');
  });

  it('mints a hosted checkout carrying the platform fee, and never a second one', async () => {
    await sql(
      `insert into public.square_connections
         (brand_id, location_id, merchant_id, square_location_id, access_token_encrypted, refresh_token_encrypted, expires_at)
       values ($1, $2, 'MERCHANT-1', $3, $4, $5, now() + interval '30 days')`,
      [brandId, locationId, SQUARE_LOCATION_ID,
        encryptToken(MERCHANT_TOKEN, TOKEN_KEY), encryptToken('refresh', TOKEN_KEY)],
    );
    await sql(
      `update public.locations set square_connection_id =
         (select id from public.square_connections where location_id = $1) where id = $1`,
      [locationId],
    );

    const key = randomUUID();
    const first = await post(ordersPost, '/api/orders', {
      token: guestToken, idempotencyKey: key, body: orderBody({ redirectUrl: 'coffeestory://order' }),
    });
    assert.equal(first.status, 201);
    const created = await first.json() as {
      orderId: string; status: string; totalCents: number; taxCents: number; checkoutUrl?: string;
    };
    assert.equal(created.checkoutUrl, 'https://square.link/u/test-checkout');
    // Rule 2: a card order is not paid until the money lands.
    assert.equal(created.status, 'created');

    const mint = captured.find((call) => call.path === '/v2/online-checkout/payment-links');
    assert.ok(mint, 'the platform asked Square for a payment link');
    assert.equal(mint.authorization, `Bearer ${MERCHANT_TOKEN}`, 'the location’s own token authorizes it');
    const order = mint.body.order as {
      location_id: string;
      reference_id: string;
      line_items: { base_price_money: { amount: number }; quantity: string }[];
      service_charges?: { name: string; amount_money: { amount: number } }[];
    };
    assert.equal(order.location_id, SQUARE_LOCATION_ID);
    assert.equal(order.reference_id, created.orderId, 'the link points back at our order');

    // The guest must be asked for the whole total. The first version sent
    // line items only, so tax and tip were never collected while the books
    // and the platform fee still counted them.
    assert.ok(created.taxCents > 0, 'this brand charges tax');
    const charged = order.line_items.reduce(
      (sum, line) => sum + line.base_price_money.amount * Number(line.quantity), 0)
      + (order.service_charges ?? []).reduce((sum, charge) => sum + charge.amount_money.amount, 0);
    assert.equal(charged, created.totalCents, 'Square is asked for exactly the order total');
    assert.equal(
      (order.service_charges ?? []).find((charge) => charge.name === 'City Sales Tax')?.amount_money.amount,
      created.taxCents,
      'tax rides as an exact amount, not a percentage Square recomputes',
    );

    const options = mint.body.checkout_options as { app_fee_money?: { amount: number }; redirect_url?: string };
    // Rule 3: 300 bps of the whole charge, to the cent.
    assert.equal(options.app_fee_money?.amount, Math.round(created.totalCents * 300 / 10_000));
    assert.equal(options.redirect_url, 'coffeestory://order');
    assert.equal(mint.body.idempotency_key, `link-${created.orderId}`);

    const before = captured.length;
    const replay = await post(ordersPost, '/api/orders', {
      token: guestToken, idempotencyKey: key, body: orderBody({ redirectUrl: 'coffeestory://order' }),
    });
    assert.equal(replay.status, 200);
    const replayed = await replay.json() as { orderId: string; checkoutUrl?: string };
    assert.equal(replayed.orderId, created.orderId);
    assert.equal(replayed.checkoutUrl, created.checkoutUrl);
    assert.equal(captured.length, before, 'a replay asks Square for nothing at all');
  });

  it('refuses a checkout redirect that is not this app’s own deep link', async () => {
    const before = captured.length;
    const response = await post(ordersPost, '/api/orders', {
      token: guestToken,
      idempotencyKey: randomUUID(),
      body: orderBody({ redirectUrl: 'https://evil.example.com/collect' }),
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'invalid_request');
    assert.equal(captured.length, before, 'Square was never asked for a page pointing off-app');
  });

  it('returns money through Square and records the refund as an event', async () => {
    // A paid card order: the shape captureSquarePayment or the webhook leaves.
    const order = await sql<{ id: string; total_cents: number }>(
      `insert into public.orders (brand_id, location_id, status, tender_type, total_cents, subtotal_cents, totals, square_payment_id)
       values ($1, $2, 'created', 'square_link', 500, 500, '{"lines":[]}'::jsonb, 'SQ-PAYMENT-1')
       returning id, total_cents`,
      [brandId, locationId],
    );
    const orderId = order.rows[0]!.id;
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'paid', 'system')`,
      [brandId, orderId],
    );

    const refundKey = randomUUID();
    const response = await post(refundPost, '/api/orders/refund', {
      token: staffToken,
      idempotencyKey: refundKey,
      body: { orderId, amountCents: 'full', reason: 'Spilled it' },
    });
    assert.equal(response.status, 200);
    const refunded = await response.json() as { refundId: string; amountCents: number };
    assert.equal(refunded.amountCents, 500);

    const call = captured.find((entry) => entry.path === '/v2/refunds');
    assert.ok(call, 'Square was asked for the refund');
    assert.equal(call.authorization, `Bearer ${MERCHANT_TOKEN}`);
    assert.equal((call.body.amount_money as { amount: number }).amount, 500);
    assert.equal(call.body.payment_id, 'SQ-PAYMENT-1');
    assert.equal(call.body.idempotency_key, `refund-${refundKey}`);

    const state = await sql<{ status: string }>(`select status from public.orders where id = $1`, [orderId]);
    assert.equal(state.rows[0]!.status, 'refunded', 'the event moved the order');
    const event = await sql<{
      source: string;
      square_refund_id: string;
      refund_cents: string;
      refund_request_key: string;
      snapshot: { refund_id: string };
    }>(
      `select source, square_refund_id, refund_cents::text, refund_request_key::text, snapshot
         from public.order_events where order_id = $1 and type = 'refunded'`,
      [orderId],
    );
    assert.equal(event.rows[0]!.source, 'operator');
    assert.equal(event.rows[0]!.snapshot.refund_id, refunded.refundId);
    assert.equal(event.rows[0]!.square_refund_id, refunded.refundId);
    assert.equal(event.rows[0]!.refund_cents, '500');
    assert.equal(event.rows[0]!.refund_request_key, refundKey);
  });

  it('requires staff to supply a UUID refund attempt key', async () => {
    const before = captured.length;
    const response = await post(refundPost, '/api/orders/refund', {
      token: staffToken,
      body: { orderId: randomUUID(), amountCents: 'full' },
    });
    assert.equal(response.status, 400);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'invalid_request');
    assert.match(body.error.message, /Idempotency-Key/);
    assert.equal(captured.length, before, 'Square was not contacted without a durable attempt key');
  });

  it('tells the barista to use the register when no card was charged', async () => {
    const order = await sql<{ id: string }>(
      `insert into public.orders (brand_id, location_id, status, tender_type, total_cents, subtotal_cents, totals)
       values ($1, $2, 'created', 'pay_at_pickup', 400, 400, '{"lines":[]}'::jsonb) returning id`,
      [brandId, locationId],
    );
    await sql(
      `insert into public.order_events (brand_id, order_id, type, source) values ($1, $2, 'paid', 'system')`,
      [brandId, order.rows[0]!.id],
    );
    const response = await post(refundPost, '/api/orders/refund', {
      token: staffToken,
      idempotencyKey: randomUUID(),
      body: { orderId: order.rows[0]!.id },
    });
    assert.equal(response.status, 409);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'refund_unavailable');
    assert.match(body.error.message, /register/);
  });

  it('serializes concurrent Square refunds and reverses loyalty exactly once per refund', async () => {
    const raceKey = randomUUID();
    const customer = await sql<{ id: string }>(
      `insert into public.customers (brand_id, full_name) values ($1, 'Refund Race') returning id`,
      [brandId],
    );
    const order = await sql<{ id: string }>(
      `insert into public.orders
         (brand_id, location_id, customer_id, status, tender_type, subtotal_cents, total_cents, square_payment_id)
       values ($1, $2, $3, 'paid', 'square_link', 500, 500, 'SQ-PAYMENT-RACE') returning id`,
      [brandId, locationId, customer.rows[0]!.id],
    );
    await sql(
      `select public.loyalty_record_earn($1, $2, $3, 50)`,
      [brandId, customer.rows[0]!.id, order.rows[0]!.id],
    );

    const refund = (eventId: string, refundId: string) => postSquareWebhook(webhookPost, {
      event_id: eventId,
      type: 'refund.updated',
      data: { object: { refund: {
        id: refundId, status: 'COMPLETED', payment_id: 'SQ-PAYMENT-RACE',
        amount_money: { amount: 250, currency: 'USD' },
      } } },
    });
    const [first, second] = await Promise.all([
      refund(`evt-refund-race-${raceKey}-1`, `refund-race-${raceKey}-1`),
      refund(`evt-refund-race-${raceKey}-2`, `refund-race-${raceKey}-2`),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await refund(
      `evt-refund-race-${raceKey}-1-retry`,
      `refund-race-${raceKey}-1`,
    )).status, 200);

    const result = await sql<{
      status: string; points_balance: string; earns: string; reversals: string; net_points: string;
    }>(
      `select target.status, account.points_balance::text,
              count(event.id) filter (where event.type = 'earn')::text as earns,
              count(event.id) filter (where event.type = 'reverse')::text as reversals,
              sum(event.points)::text as net_points
       from public.orders target
       join public.loyalty_accounts account on account.customer_id = target.customer_id
       join public.loyalty_events event on event.account_id = account.id
       where target.id = $1
       group by target.status, account.points_balance`,
      [order.rows[0]!.id],
    );
    assert.deepEqual(result.rows[0], {
      status: 'refunded', points_balance: '0', earns: '1', reversals: '2', net_points: '0',
    });
  });

  it('never lets a guest refund an order', async () => {
    const order = await sql<{ id: string }>(
      `select id from public.orders where brand_id = $1 and square_payment_id is not null limit 1`,
      [brandId],
    );
    const response = await post(refundPost, '/api/orders/refund', {
      token: guestToken,
      idempotencyKey: randomUUID(),
      body: { orderId: order.rows[0]!.id },
    });
    assert.equal(response.status, 403);
  });
});
