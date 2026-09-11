import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';

import { POST } from '../app/api/webhooks/square/route';

const WEBHOOK_URL = 'https://app.example.test/api/webhooks/square';
const KEY = 'test-signature-key';
const ENV = {
  SQUARE_WEBHOOK_SIGNATURE_KEY: KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};

function requestFor(value: unknown, body = JSON.stringify(value), signature = sign(body)): Request {
  return new Request(WEBHOOK_URL, {
    method: 'POST', body, headers: { 'x-square-hmacsha256-signature': signature },
  });
}

function sign(body: string): string {
  return createHmac('sha256', KEY).update(WEBHOOK_URL + body).digest('base64');
}

async function withWebhookEnv(run: () => Promise<void>): Promise<void> {
  const originals = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, ENV);
  try { await run(); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

describe('Square webhook delivery state', () => {
  it('rejects unconfigured, unsigned, malformed, and unmappable requests at the boundary', async () => {
    await withWebhookEnv(async () => {
      delete process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
      assert.equal((await POST(requestFor({ event_id: 'ignored' }))).status, 501);
      process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = KEY;

      assert.equal((await POST(requestFor({ event_id: 'ignored' }, undefined, 'wrong'))).status, 401);
      assert.equal((await POST(requestFor(null, '{', sign('{')))).status, 400);
      assert.equal((await POST(requestFor({ type: 'payment.updated' }))).status, 400);
    });
  });

  it('retries a transient delivery write and stamps a non-terminal update', async () => {
    await withWebhookEnv(async () => {
      let deliveryAttempts = 0;
      const stamps: Record<string, unknown>[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        assert.ok(url.pathname.endsWith('/webhook_events'));
        if (init?.method === 'POST') {
          deliveryAttempts += 1;
          return deliveryAttempts === 1
            ? Response.json({ message: 'temporary' }, { status: 503 })
            : Response.json(null, { status: 201 });
        }
        if (init?.method === 'PATCH') {
          stamps.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json(null);
        }
        return Response.json({ processed_at: null });
      };
      const response = await POST(requestFor({
        event_id: 'pending-event', type: 'payment.updated',
        data: { object: { payment: { id: 'payment', status: 'APPROVED' } } },
      }));
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'Recorded, no transition');
      assert.equal(deliveryAttempts, 2);
      assert.equal(typeof stamps[0]?.processed_at, 'string');
      assert.equal(stamps[0]?.error, null);
    });
  });

  it('persists a cancelled order transition before stamping the delivery', async () => {
    await withWebhookEnv(async () => {
      const writes: { path: string; body: Record<string, unknown> }[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/orders')) {
          assert.equal(url.searchParams.get('square_order_id'), 'eq.square-order');
          return Response.json({ id: 'order', brand_id: 'brand', location_id: 'location',
            status: 'created', total_cents: 1200, stored_value_applied_cents: 0 });
        }
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          writes.push({ path: url.pathname, body });
          return url.pathname.endsWith('/order_events') ? Response.json([{ id: 'event-row' }])
            : Response.json(null, { status: 201 });
        }
        if (init?.method === 'PATCH') {
          writes.push({ path: url.pathname,
            body: JSON.parse(String(init.body)) as Record<string, unknown> });
          return Response.json(null);
        }
        return Response.json({ processed_at: null });
      };
      const response = await POST(requestFor({
        event_id: 'cancel-event', type: 'order.updated',
        data: { object: { order: { id: 'square-order', state: 'CANCELED' } } },
      }));
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'OK');
      assert.deepEqual(writes.map((write) => write.path), [
        '/rest/v1/webhook_events', '/rest/v1/order_events', '/rest/v1/webhook_events',
      ]);
      assert.equal(writes[1]?.body.type, 'cancelled');
      assert.equal((writes[1]?.body.snapshot as Record<string, unknown>).square_event_id, 'cancel-event');
      assert.equal(typeof writes[2]?.body.processed_at, 'string');
    });
  });

  it('short-circuits an already processed replay without resolving its order', async () => {
    await withWebhookEnv(async () => {
      const paths: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        if (init?.method === 'POST') return Response.json(null, { status: 201 });
        return Response.json({ processed_at: '2026-09-08T00:00:00.000Z' });
      };
      const response = await POST(requestFor({
        event_id: 'replay-event', type: 'order.updated',
        data: { object: { order: { id: 'square-order', state: 'CANCELED' } } },
      }));
      assert.equal(await response.text(), 'Already handled');
      assert.deepEqual(paths, ['/rest/v1/webhook_events', '/rest/v1/webhook_events']);
    });
  });

  it('rejects a completed payment from a different Square location', async () => {
    await withWebhookEnv(async () => {
      const paths: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        if (url.pathname.endsWith('/webhook_events')) {
          return init?.method === 'POST'
            ? Response.json(null, { status: 201 }) : Response.json({ processed_at: null });
        }
        if (url.pathname.endsWith('/orders')) return Response.json({
          id: 'order', brand_id: 'brand', location_id: 'location', status: 'created',
          total_cents: 1_000, stored_value_applied_cents: 0,
        });
        if (url.pathname.endsWith('/square_connections')) {
          assert.equal(url.searchParams.get('brand_id'), 'eq.brand');
          assert.equal(url.searchParams.get('location_id'), 'eq.location');
          return Response.json({ square_location_id: 'expected-square-location' });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      };
      const response = await POST(requestFor({
        event_id: 'wrong-location', type: 'payment.updated',
        data: { object: { payment: {
          id: 'payment', order_id: 'square-order', location_id: 'other-square-location',
          status: 'COMPLETED', total_money: { amount: 1_000, currency: 'USD' },
          app_fee_money: { amount: 30, currency: 'USD' },
        } } },
      }));
      assert.equal(response.status, 422);
      assert.equal(await response.text(), 'Invalid payment settlement location');
      assert.ok(paths.includes('/rest/v1/square_connections'));
    });
  });
});
