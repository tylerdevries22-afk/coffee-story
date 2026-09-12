import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { cancelOrder } from './cancel-order';

function fixture(options: {
  eventError?: string; status?: string; squarePaymentId?: string | null;
} = {}) {
  let eventWrites = 0;
  const db = createClient('https://database.example', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (request, init) => {
      const table = new URL(String(request)).pathname.split('/').at(-1);
      if (table === 'orders') return Response.json({
        id: 'order-a', brand_id: 'brand-a', customer_id: 'customer-a',
        status: options.status ?? 'created', tender_type: 'square_card', total_cents: 1_000,
        square_payment_id: options.squarePaymentId ?? null,
      });
      if (table === 'order_events' && init?.method === 'POST') {
        eventWrites += 1;
        if (options.eventError) return new Response(JSON.stringify({
          code: 'P0001', message: options.eventError,
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
  const f = fixture({ eventError: 'square_card_payment_in_flight: order-a claim-secret' });
  await assert.rejects(cancelOrder({ db: f.db }, input), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'cancel_unavailable');
    assert.doesNotMatch(error.message, /order-a|claim-secret|square_card_payment_in_flight/u);
    return true;
  });
});

// Every fixture elsewhere in this suite hardcodes square_payment_id: null. A
// guest whose card already captured must be sent to the shop for a refund,
// not let cancel the order out from under a payment that already moved —
// and the event table must never even see the attempt, since a write that
// raced past this guard would need the "already started" story to hold.
test('a bound card payment blocks cancellation before any event is written, regardless of status', async () => {
  for (const status of ['paid', 'created']) {
    const f = fixture({ status, squarePaymentId: 'payment-1' });
    await assert.rejects(cancelOrder({ db: f.db }, input), (error: Error & { code?: string }) => {
      assert.equal(error.code, 'cancel_unavailable');
      return true;
    });
    assert.equal(f.eventWrites(), 0);
  }
});
