import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { encryptToken, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DueSquareCard } from './square-card-maintenance-types';
import { recoverDueSquareCard } from './square-card-recovery';

const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
  apiBase: 'https://square.example.test',
};
const tokenKey = Buffer.alloc(32, 5);
const orderId = '11111111-1111-4111-8111-111111111111';
function card(over: Partial<DueSquareCard> = {}): DueSquareCard {
  return {
    orderId, brandId: 'brand-a', locationId: 'location-a',
    expiresAt: '2026-09-08T00:00:00.000Z',
    claimGeneration: '44444444-4444-4444-8444-444444444444',
    squareOrderId: null, squarePaymentId: null,
    squareLocationId: 'square-location-a', grossCents: 10_000,
    providerOrderTotalCents: 9_500, expectedFeeCents: 300,
    feeBpsApplied: 300, accessTokenEncrypted: encryptToken('token', tokenKey),
    valid: true, ...over,
  };
}
function installKey(t: TestContext): void {
  const prior = process.env.SQUARE_TOKEN_KEY;
  process.env.SQUARE_TOKEN_KEY = tokenKey.toString('base64');
  t.after(() => {
    if (prior === undefined) delete process.env.SQUARE_TOKEN_KEY;
    else process.env.SQUARE_TOKEN_KEY = prior;
  });
}
const response = () => new Response(JSON.stringify({ order: {
  id: 'square-order-a', location_id: 'square-location-a', reference_id: orderId,
  total_money: { amount: 9_500, currency: 'USD' },
} }), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('cleanup replays a lost CreateOrder response and binds under its lease', async (t) => {
  installKey(t);
  const providerBodies: Record<string, unknown>[] = [];
  t.mock.method(globalThis, 'fetch', async (
    _input: RequestInfo | URL, init?: RequestInit,
  ) => {
    providerBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (providerBodies.length === 1) throw new TypeError('response lost');
    return response();
  });
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: unknown) => {
    calls.push({ name, args }); return { data: true, error: null };
  } } as unknown as SupabaseClient;
  const recovered = await recoverDueSquareCard(db, square, card());
  assert.equal(recovered.squareOrderId, 'square-order-a');
  assert.equal(providerBodies.length, 2);
  assert.deepEqual(providerBodies[0], providerBodies[1]);
  assert.deepEqual(providerBodies[0], {
    idempotency_key: `order-${orderId}`,
    order: { location_id: 'square-location-a', reference_id: orderId,
      line_items: [{ name: 'Card-funded order balance', quantity: '1',
        base_price_money: { amount: 9_500, currency: 'USD' } }] },
  });
  assert.deepEqual(calls, [{ name: 'bind_square_payment_attempt', args: {
    p_order_id: orderId,
    p_claim_generation: '44444444-4444-4444-8444-444444444444',
    p_square_order_id: 'square-order-a',
  } }]);
});

test('cleanup rejects wrong provider identity and stale recovery ownership', async (t) => {
  installKey(t);
  let wrongLocation = true;
  t.mock.method(globalThis, 'fetch', async () => wrongLocation
    ? new Response(JSON.stringify({ order: {
      id: 'square-order-a', location_id: 'other', reference_id: orderId,
      total_money: { amount: 9_500, currency: 'USD' },
    } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : response());
  let binds = 0;
  const db = {
    rpc: async () => { binds += 1; return { data: false, error: null }; },
  } as unknown as SupabaseClient;
  await assert.rejects(recoverDueSquareCard(db, square, card()), /identity mismatch/);
  assert.equal(binds, 0);
  wrongLocation = false;
  await assert.rejects(recoverDueSquareCard(db, square, card()), /Stale/);
  assert.equal(binds, 1);
});
