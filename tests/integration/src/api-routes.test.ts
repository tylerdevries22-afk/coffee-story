import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import { GET as healthGet } from '../../../apps/hq/app/api/health/route.ts';
import { POST as jobsPost } from '../../../apps/hq/app/api/jobs/run/route.ts';
import { POST as redeemPost } from '../../../apps/hq/app/api/loyalty/redeem/route.ts';
import { POST as ordersPost } from '../../../apps/hq/app/api/orders/route.ts';
import { POST as profilePost } from '../../../apps/hq/app/api/profile/route.ts';
import { POST as pushTokensPost } from '../../../apps/hq/app/api/push-tokens/route.ts';
import { POST as referralsPost } from '../../../apps/hq/app/api/referrals/route.ts';

import { createSignedInUser, seedBrand, skipUnlessConfigured, sql, stack } from './stack.ts';

/**
 * The platform API, in process: each handler is a plain function taking a
 * Request, so the whole HTTP surface runs against the real stack with no
 * server to boot. This is where "the client sends slugs, the server prices
 * them" is proven against actual menu rows and RLS-minted claims.
 */

// The routes read env per request; point them at the stack under test.
process.env.SUPABASE_URL = stack.url;
process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceRoleKey;
process.env.CRON_SECRET = 'integration-cron-secret';

const SLUG = 'api-routes';

function post(handler: (request: Request) => Promise<Response>, path: string, options: {
  token?: string;
  idempotencyKey?: string;
  body?: unknown;
  rawAuthorization?: string;
}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.rawAuthorization) headers.authorization = options.rawAuthorization;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  return handler(new Request(`http://hq.test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body ?? {}),
  }));
}

const LATTE_MODIFIERS = [
  {
    id: 'milk', name: 'Milk', select: 'single', required: false, maxChoices: 1,
    choices: [
      { id: 'milk-whole', name: 'Whole Milk', priceDeltaCents: 0 },
      { id: 'milk-oat', name: 'Oat Milk', priceDeltaCents: 75 },
    ],
  },
  {
    id: 'extras', name: 'Add-ins', select: 'multi', required: false, maxChoices: 2,
    choices: [
      { id: 'extra-shot', name: 'Extra Shot', priceDeltaCents: 100 },
      { id: 'extra-vanilla', name: 'Vanilla', priceDeltaCents: 75 },
    ],
  },
  {
    id: 'serve', name: 'Serve', select: 'single', required: true, maxChoices: 1,
    choices: [
      { id: 'serve-hot', name: 'Hot', priceDeltaCents: 0 },
      { id: 'serve-iced', name: 'Iced', priceDeltaCents: 0 },
    ],
  },
];

describe('platform API routes', { skip: skipUnlessConfigured }, () => {
  let brandId = '';
  let locationId = '';
  let token = '';
  let userId = '';

  before(async function setup() {
    if (skipUnlessConfigured) return;
    ({ brandId, locationId } = await seedBrand(SLUG));
    await sql(
      `update public.brands set brand_config = $2 where id = $1`,
      [brandId, JSON.stringify({
        tax: {
          jurisdictions: [
            { id: 'state', label: 'State Sales Tax', rate: 0.029 },
            { id: 'city', label: 'City Sales Tax', rate: 0.0375 },
          ],
        },
        loyalty: { rewards: [{ slug: 'free-drip', name: 'Free Drip Coffee', points_cost: 200 }] },
      })],
    );
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
       values
        ($1, $2, $3, 'latte', 'Latte', 450,
         '[{"slug":"12","label":"12 oz","price_cents":450},{"slug":"16","label":"16 oz","price_cents":525}]'::jsonb,
         $4::jsonb, 1),
        ($1, $2, $3, 'cookie', 'Cookie', 350, '[]'::jsonb, '[]'::jsonb, 2)`,
      [brandId, menu.rows[0]!.id, category.rows[0]!.id, JSON.stringify(LATTE_MODIFIERS)],
    );
    const guest = await createSignedInUser({ userMetadata: { brand_slug: SLUG } });
    token = guest.accessToken;
    userId = guest.userId;
  });

  it('GET /api/health answers without a database', async () => {
    const response = healthGet();
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; version: string };
    assert.equal(body.ok, true);
    assert.equal(typeof body.version, 'string');
  });

  it('POST /api/orders requires a bearer token', async () => {
    const response = await post(ordersPost, '/api/orders', { body: {} });
    assert.equal(response.status, 401);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, 'unauthorized');
  });

  it('places a pay_at_pickup order with server-side prices, replays on the same key', async () => {
    const key = randomUUID();
    const orderBody = {
      locationId,
      fulfillmentType: 'pickup',
      lines: [
        { itemSlug: 'latte', sizeSlug: '16', quantity: 2, modifierSlugs: ['milk-oat', 'extra-shot', 'serve-hot'] },
        { itemSlug: 'cookie', quantity: 3 },
      ],
      tipCents: 111,
      tenderType: 'pay_at_pickup',
      note: 'extra hot please',
    };
    const placed = await post(ordersPost, '/api/orders', { token, idempotencyKey: key, body: orderBody });
    assert.equal(placed.status, 201);
    const order = await placed.json() as {
      orderId: string; status: string; subtotalCents: number; taxCents: number; tipCents: number; totalCents: number;
    };
    // latte: (525 + 75 + 100) x 2 = 1400; cookie: 350 x 3 = 1050.
    assert.equal(order.subtotalCents, 2450);
    // Per-row rounding: round(2450*.029)=71, round(2450*.0375)=92.
    assert.equal(order.taxCents, 163);
    assert.equal(order.totalCents, 2450 + 163 + 111);
    assert.equal(order.status, 'paid', 'pay_at_pickup lands on the board immediately');

    const row = await sql<{ status: string; tender_type: string; client_key: string; total_cents: string }>(
      `select status, tender_type, client_key, total_cents from public.orders where id = $1`,
      [order.orderId],
    );
    assert.equal(row.rows[0]!.status, 'paid');
    assert.equal(row.rows[0]!.tender_type, 'pay_at_pickup');
    assert.equal(row.rows[0]!.client_key, key);
    const events = await sql<{ type: string; source: string }>(
      `select type, source from public.order_events where order_id = $1 order by created_at`,
      [order.orderId],
    );
    assert.deepEqual(events.rows.map((event) => event.type), ['created', 'paid']);

    // The guest's first order created their customer row and earned points.
    const account = await sql<{ points_balance: string }>(
      `select a.points_balance from public.loyalty_accounts a
       join public.customers c on c.id = a.customer_id where c.user_id = $1`,
      [userId],
    );
    assert.equal(Number(account.rows[0]!.points_balance), 245);

    const replayed = await post(ordersPost, '/api/orders', { token, idempotencyKey: key, body: orderBody });
    assert.equal(replayed.status, 200);
    const replay = await replayed.json() as { orderId: string };
    assert.equal(replay.orderId, order.orderId);
    const count = await sql<{ n: string }>(
      `select count(*) as n from public.orders where brand_id = $1 and client_key = $2`,
      [brandId, key],
    );
    assert.equal(Number(count.rows[0]!.n), 1);
  });

  it('refuses what the menu does not sell', async () => {
    const base = { locationId, fulfillmentType: 'pickup', tipCents: 0, tenderType: 'pay_at_pickup' };
    const ghost = await post(ordersPost, '/api/orders', {
      token, body: { ...base, lines: [{ itemSlug: 'off-menu', quantity: 1 }] },
    });
    assert.equal(ghost.status, 409);
    assert.equal(((await ghost.json()) as { error: { code: string } }).error.code, 'item_unavailable');

    const rigged = await post(ordersPost, '/api/orders', {
      token, body: { ...base, lines: [{ itemSlug: 'cookie', quantity: 1, modifierSlugs: ['extra-free-everything'] }] },
    });
    assert.equal(rigged.status, 400);
    assert.equal(((await rigged.json()) as { error: { code: string } }).error.code, 'modifier_unknown');

    const card = await post(ordersPost, '/api/orders', {
      token, body: { ...base, lines: [{ itemSlug: 'cookie', quantity: 1 }], tenderType: 'square_link' },
    });
    assert.equal(card.status, 503);
    assert.equal(((await card.json()) as { error: { code: string } }).error.code, 'tender_unavailable');
  });

  it('answers 409 while ordering is paused', async () => {
    await sql(`update public.locations set ordering_paused = true where id = $1`, [locationId]);
    try {
      const paused = await post(ordersPost, '/api/orders', {
        token,
        body: {
          locationId, fulfillmentType: 'pickup', tipCents: 0, tenderType: 'pay_at_pickup',
          lines: [{ itemSlug: 'cookie', quantity: 1 }],
        },
      });
      assert.equal(paused.status, 409);
      assert.equal(((await paused.json()) as { error: { code: string } }).error.code, 'ordering_paused');
    } finally {
      await sql(`update public.locations set ordering_paused = false where id = $1`, [locationId]);
    }
  });

  it('redeems a configured reward once per idempotency key', async () => {
    const key = randomUUID();
    const first = await post(redeemPost, '/api/loyalty/redeem', {
      token, idempotencyKey: key, body: { rewardSlug: 'free-drip' },
    });
    assert.equal(first.status, 200);
    const balance = ((await first.json()) as { pointsBalance: number }).pointsBalance;
    assert.equal(balance, 45, '245 earned - 200 reward');

    const replay = await post(redeemPost, '/api/loyalty/redeem', {
      token, idempotencyKey: key, body: { rewardSlug: 'free-drip' },
    });
    assert.equal(replay.status, 200);
    assert.equal(((await replay.json()) as { pointsBalance: number }).pointsBalance, 45, 'a retry does not spend twice');

    const broke = await post(redeemPost, '/api/loyalty/redeem', {
      token, idempotencyKey: randomUUID(), body: { rewardSlug: 'free-drip' },
    });
    assert.equal(broke.status, 409);
    assert.equal(((await broke.json()) as { error: { code: string } }).error.code, 'insufficient_points');

    const unknown = await post(redeemPost, '/api/loyalty/redeem', {
      token, body: { rewardSlug: 'yacht' },
    });
    assert.equal(unknown.status, 404);
  });

  it('registers a push token and re-homes it on re-registration', async () => {
    const deviceToken = `ExponentPushToken[${randomUUID()}]`;
    const first = await post(pushTokensPost, '/api/push-tokens', {
      token, body: { token: deviceToken, platform: 'ios' },
    });
    assert.equal(first.status, 200);
    const again = await post(pushTokensPost, '/api/push-tokens', {
      token, body: { token: deviceToken, platform: 'android' },
    });
    assert.equal(again.status, 200);
    const rows = await sql<{ platform: string }>(
      `select platform from public.push_tokens where token = $1`,
      [deviceToken],
    );
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0]!.platform, 'android');
  });

  it('updates the profile and defends the phone uniqueness', async () => {
    // Unique per run: the phone column is UNIQUE per brand.
    const phone = `+1${String(Date.now()).slice(-10)}`;
    const updated = await post(profilePost, '/api/profile', {
      token, body: { fullName: 'Reader One', phone },
    });
    assert.equal(updated.status, 200);
    const row = await sql<{ full_name: string; phone: string }>(
      `select full_name, phone from public.customers where user_id = $1`,
      [userId],
    );
    assert.equal(row.rows[0]!.full_name, 'Reader One');
    assert.equal(row.rows[0]!.phone, phone);

    const other = await createSignedInUser({ userMetadata: { brand_slug: SLUG } });
    const conflict = await post(profilePost, '/api/profile', {
      token: other.accessToken, body: { phone },
    });
    assert.equal(conflict.status, 409);
    assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, 'phone_in_use');
  });

  it('mints one referral code per guest and re-surfaces it', async () => {
    const first = await post(referralsPost, '/api/referrals', { token, body: {} });
    assert.equal(first.status, 201);
    const code = ((await first.json()) as { code: string }).code;
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    const again = await post(referralsPost, '/api/referrals', { token, body: {} });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { code: string }).code, code);
  });

  it('runs the cron tick under CRON_SECRET only', async () => {
    const item = await sql<{ id: string }>(
      `select id from public.menu_items where brand_id = $1 and slug = 'latte'`,
      [brandId],
    );
    const drop = await sql<{ id: string }>(
      `insert into public.drops (brand_id, item_id, starts_at, ends_at, status)
       values ($1, $2, now() - interval '1 hour', now() + interval '1 hour', 'scheduled') returning id`,
      [brandId, item.rows[0]!.id],
    );
    const campaign = await sql<{ id: string }>(
      `insert into public.campaigns (brand_id, channel, name, subject, body, status, scheduled_at)
       values ($1, 'push', 'Drop live', 'It is on', 'Come get it', 'scheduled', now() - interval '5 minutes') returning id`,
      [brandId],
    );

    const denied = await post(jobsPost, '/api/jobs/run', { rawAuthorization: 'Bearer wrong' });
    assert.equal(denied.status, 401);

    const run = await post(jobsPost, '/api/jobs/run', {
      rawAuthorization: `Bearer ${process.env.CRON_SECRET}`,
    });
    assert.equal(run.status, 200);
    const dropRow = await sql<{ status: string }>(`select status from public.drops where id = $1`, [drop.rows[0]!.id]);
    assert.equal(dropRow.rows[0]!.status, 'live');
    const campaignRow = await sql<{ status: string; stats: { delivered?: number } }>(
      `select status, stats from public.campaigns where id = $1`,
      [campaign.rows[0]!.id],
    );
    assert.equal(campaignRow.rows[0]!.status, 'sent');
    assert.equal(campaignRow.rows[0]!.stats.delivered, 0);
  });
});
