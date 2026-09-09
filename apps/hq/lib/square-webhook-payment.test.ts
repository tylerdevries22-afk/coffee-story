import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { POST } from '../app/api/webhooks/square/route';

const url = 'https://app.example.test/api/webhooks/square';
const key = 'test-signature-key';
const env = {
  SQUARE_WEBHOOK_SIGNATURE_KEY: key,
  SQUARE_WEBHOOK_URL: url,
  SUPABASE_URL: 'https://database.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
};
function event(amount = 1_000) {
  return {
    event_id: 'payment-event', type: 'payment.updated',
    data: { object: { payment: {
      id: 'square-payment', order_id: 'square-order', location_id: 'square-location',
      status: 'COMPLETED', total_money: { amount, currency: 'USD' },
      app_fee_money: { amount: 30, currency: 'USD' },
    } } },
  };
}
function request(value: unknown): Request {
  const body = JSON.stringify(value);
  const signature = createHmac('sha256', key).update(url + body).digest('base64');
  return new Request(url, {
    method: 'POST', body, headers: { 'x-square-hmacsha256-signature': signature },
  });
}
async function withEnv(run: () => Promise<void>): Promise<void> {
  const previous = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  try { await run(); }
  finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}
function databaseFetch(settlements: Record<string, unknown>[]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/webhook_events')) {
      if (init?.method === 'POST') return Response.json(null, { status: 201 });
      if (init?.method === 'PATCH') return Response.json(null);
      return Response.json({ processed_at: null });
    }
    if (path.endsWith('/orders')) return Response.json({
      id: 'order', brand_id: 'brand', location_id: 'location', status: 'created',
      total_cents: 1_000, stored_value_applied_cents: 0,
    });
    if (path.endsWith('/square_connections')) {
      return Response.json({ square_location_id: 'square-location' });
    }
    if (path.endsWith('/record_square_payment_settlement')) {
      settlements.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(true);
    }
    throw new Error(`Unexpected database path ${path}`);
  };
}

test('paid webhook submits every exact settlement identity', async () => withEnv(async () => {
  const settlements: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = databaseFetch(settlements);
  try {
    const response = await POST(request(event()));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'OK');
    assert.deepEqual(settlements, [{
      target_order: 'order', square_event: 'payment-event', square_order: 'square-order',
      square_payment: 'square-payment', settled_fee_cents: 30,
      square_event_type: 'payment.updated',
    }]);
  } finally { globalThis.fetch = original; }
}));

test('paid webhook rejects a provider gross mismatch before settlement', async () => withEnv(async () => {
  const settlements: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = databaseFetch(settlements);
  try {
    const response = await POST(request(event(999)));
    assert.equal(response.status, 422);
    assert.equal(await response.text(), 'Invalid payment settlement amounts');
    assert.deepEqual(settlements, []);
  } finally { globalThis.fetch = original; }
}));
