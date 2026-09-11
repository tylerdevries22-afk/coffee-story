import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { cancelOrder } from './cancel-order';

function fixture(eventError?: string) {
  let eventWrites = 0;
  const db = createClient('https://database.example', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const table = new URL(String(request)).pathname.split('/').at(-1);
      if (table === 'orders') return Response.json({
        id: 'order-a', brand_id: 'brand-a', customer_id: 'customer-a',
        status: 'created', tender_type: 'square_card', total_cents: 1_000,
        square_payment_id: null,
      });
      if (table === 'order_events' && init?.method === 'POST') {
        eventWrites += 1;
        if (eventError) return new Response(JSON.stringify({
          code: 'P0001', message: eventError,
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        return Response.json(null);
      }
      throw new Error(`Unexpected database table ${table}`);
    } },
  });
  return { db, eventWrites: () => eventWrites };
}

const input = {
  orderId: 'order-a', customerId: 'customer-a', actorUserId: 'user-a', reason: 'mistake',
};

test('guest cancellation succeeds when no active card attempt blocks the event', async () => {
  const f = fixture();
  assert.deepEqual(await cancelOrder({ db: f.db }, input), {
    orderId: 'order-a', status: 'cancelled', alreadyCancelled: false,
  });
  assert.equal(f.eventWrites(), 1);
});

test('active card claim races produce a stable user-safe cancellation error', async () => {
  const f = fixture('square_card_payment_in_flight: order-a claim-secret');
  await assert.rejects(cancelOrder({ db: f.db }, input), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'cancel_unavailable');
    assert.doesNotMatch(error.message, /order-a|claim-secret|square_card_payment_in_flight/u);
    return true;
  });
});
