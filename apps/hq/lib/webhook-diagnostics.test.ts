import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { POST } from '../app/api/webhooks/square/route';
import { recordWebhookFailure } from './webhook-diagnostics';

for (const stage of ['refund', 'order_event'] as const) {
for (const persistenceFails of [false, true]) {
  test(`${stage} failure keeps safe context when diagnostic persistence ${persistenceFails ? 'fails' : 'succeeds'}`, async () => {
    const env = { SQUARE_WEBHOOK_SIGNATURE_KEY: 'test-signature-key',
      SQUARE_WEBHOOK_URL: 'https://app.example.test/api/webhooks/square',
      SUPABASE_URL: 'https://database.example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' };
    const originals = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    const originalFetch = globalThis.fetch;
    const originalLog = console.error;
    const logs: unknown[][] = [];
    const writes: Record<string, unknown>[] = [];
    Object.assign(process.env, env);
    console.error = (...args: unknown[]) => { logs.push(args); };
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/rpc/process_square_refund') || url.pathname.endsWith('/order_events')) {
        return Response.json({ code: '23514', message: 'sensitive database detail' }, { status: 400 });
      }
      if (url.pathname.endsWith('/orders')) return Response.json({ id: 'order', brand_id: 'brand',
        location_id: 'location', total_cents: 1000, stored_value_applied_cents: 0, status: 'paid' });
      assert.ok(url.pathname.endsWith('/webhook_events'));
      if (init?.method === 'POST') return Response.json(null, { status: 201 });
      if (init?.method === 'PATCH') {
        writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        assert.equal(url.searchParams.get('event_id'), 'eq.refund-event');
        return persistenceFails
          ? Response.json({ code: '42501', message: 'another sensitive detail' }, { status: 400 })
          : Response.json({ event_id: 'refund-event' });
      }
      return Response.json({ processed_at: null });
    };
    try {
      const object = stage === 'refund'
        ? { refund: { id: 'refund', status: 'COMPLETED', payment_id: 'payment', amount_money: { amount: 200, currency: 'USD' } } }
        : { payment: { id: 'payment', status: 'COMPLETED' } };
      const body = JSON.stringify({ event_id: 'refund-event',
        type: stage === 'refund' ? 'refund.updated' : 'payment.updated', data: { object } });
      const signature = createHmac('sha256', env.SQUARE_WEBHOOK_SIGNATURE_KEY)
        .update(env.SQUARE_WEBHOOK_URL + body).digest('base64');
      const response = await POST(new Request(env.SQUARE_WEBHOOK_URL, {
        method: 'POST', body, headers: { 'x-square-hmacsha256-signature': signature },
      }));
      assert.equal(response.status, 409);
      assert.equal(await response.text(), stage === 'refund' ? 'Refund processing failed' : 'Event rejected');
      assert.deepEqual(writes, [{ error: JSON.stringify({ stage, code: '23514' }) }]);
      assert.deepEqual(logs[0]?.[1], { level: 'error', provider: 'square', stage, code: '23514',
        diagnosticStored: !persistenceFails, eventId: 'refund-event', orderId: 'order', brandId: 'brand' });
      assert.ok(!JSON.stringify(logs).includes('sensitive'));
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalLog;
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
}
}

test('diagnostic transport failure still logs safely without exposing arbitrary error fields', async () => {
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const db = { from() { throw new Error('sensitive transport detail'); } } as unknown as SupabaseClient;
    await recordWebhookFailure(db, { eventId: 'unsafe\nidentifier', orderId: 'order', brandId: 'brand', stage: 'platform_fee' },
      { code: 'sensitive-invalid-code', message: 'sensitive' });
    assert.deepEqual(logs[0]?.[1], { level: 'error', provider: 'square', stage: 'platform_fee', code: 'processing_failed',
      diagnosticStored: false, eventId: 'invalid_identifier', orderId: 'order', brandId: 'brand' });
    assert.ok(!JSON.stringify(logs).includes('sensitive'));
  } finally { console.error = original; }
});
