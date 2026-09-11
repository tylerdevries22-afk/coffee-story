import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { expireDueSquareCardQuotes, type DueSquareCard } from './square-card-maintenance';

const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
  apiBase: 'https://square.example.test',
};
const emptyDb = {} as SupabaseClient;
function card(over: Partial<DueSquareCard> = {}): DueSquareCard {
  return {
    orderId: '11111111-1111-4111-8111-111111111111',
    brandId: '22222222-2222-4222-8222-222222222222',
    locationId: '33333333-3333-4333-8333-333333333333',
    expiresAt: '2026-09-08T00:00:00.000Z',
    claimGeneration: '44444444-4444-4444-8444-444444444444',
    squareOrderId: 'square-order-a', squarePaymentId: null,
    squareLocationId: 'square-location-a', grossCents: 1_000,
    providerOrderTotalCents: 900,
    expectedFeeCents: 30, feeBpsApplied: 300,
    accessTokenEncrypted: 'ciphertext', valid: true, ...over,
  };
}

describe('Square card attempt maintenance', () => {
  it('leases no more than fifty expired attempts per tick', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args }); return { data: [], error: null };
    } } as unknown as SupabaseClient;
    const now = new Date('2026-09-08T15:30:00.000Z');
    const result = await expireDueSquareCardQuotes(db, square, now);
    assert.deepEqual(calls, [{
      name: 'claim_due_square_card_quotes', args: { p_now: now.toISOString(), p_limit: 50 },
    }]);
    assert.equal(result.scanned, 0);
  });

  it('loads exact quote, tenant, provider location, and cancelled local orders', async () => {
    const due = card();
    const claim = {
      order_id: due.orderId, brand_id: due.brandId, location_id: due.locationId,
      expires_at: due.expiresAt, claim_generation: due.claimGeneration,
      square_order_id: due.squareOrderId, square_payment_id: due.squarePaymentId,
      gross_cents: 1_000, quoted_fee_cents: 30, quoted_fee_bps_applied: 300,
    };
    const query = (data: unknown[]) => ({
      select() { return this; }, in() { return this; },
      async returns<T>() { return { data: data as T, error: null }; },
    });
    let loaded: DueSquareCard | undefined;
    const db = {
      rpc: async () => ({ data: [claim], error: null }),
      from: (table: string) => query(table === 'orders' ? [{
        id: due.orderId, status: 'cancelled', tender_type: 'square_card',
        brand_id: due.brandId, location_id: due.locationId,
        total_cents: 1_000, tip_cents: 100, stored_value_applied_cents: 0,
        square_order_id: due.squareOrderId, square_payment_id: null,
      }] : [{
        brand_id: due.brandId, location_id: due.locationId,
        square_location_id: due.squareLocationId, access_token_encrypted: 'token',
      }]),
    } as unknown as SupabaseClient;
    const result = await expireDueSquareCardQuotes(db, square, new Date(), {
      inspect: async (_config, row) => {
        loaded = row; return { kind: 'payment', paymentId: 'pay', feeCents: 30 };
      },
      reconcile: async () => true,
    });
    assert.equal(loaded?.valid, true);
    assert.equal(loaded?.expectedFeeCents, 30);
    assert.equal(loaded?.providerOrderTotalCents, 900);
    assert.equal(loaded?.squareLocationId, 'square-location-a');
    assert.equal(result.reconciled, 1);
  });

  it('expires only after recovery supplies exact cancelled provider evidence', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args }); return { data: true, error: null };
    } } as unknown as SupabaseClient;
    const due = card({ squareOrderId: null });
    const recovered = { ...due, squareOrderId: 'recovered-square-order' };
    const result = await expireDueSquareCardQuotes(db, square, new Date(), {
      load: async () => [due],
      recover: async () => recovered,
      inspect: async () => ({
        kind: 'unpaid', squareOrderId: recovered.squareOrderId, providerOrderVersion: 7,
        providerOrderState: 'CANCELED', squarePaymentId: null, providerPaymentState: null,
      }),
    });
    assert.equal(result.expired, 1);
    assert.deepEqual(calls, [{ name: 'expire_square_card_quote', args: {
      p_order_id: due.orderId, p_claim_generation: due.claimGeneration,
      p_square_order_id: recovered.squareOrderId, p_provider_order_version: 7,
      p_provider_order_state: 'CANCELED', p_square_payment_id: null,
      p_provider_payment_state: null,
    } }]);
  });

  it('records exact completed settlement and treats false as durable replay', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args }); return { data: false, error: null };
    } } as unknown as SupabaseClient;
    const due = card();
    const result = await expireDueSquareCardQuotes(db, square, new Date(), {
      load: async () => [due],
      inspect: async () => ({ kind: 'payment', paymentId: 'payment-a', feeCents: 30 }),
    });
    assert.equal(result.reconciled, 1);
    assert.deepEqual(calls, [{ name: 'record_square_payment_settlement', args: {
      target_order: due.orderId, square_event: 'reconcile:payment-a',
      square_order: due.squareOrderId,
      square_payment: 'payment-a', settled_fee_cents: 30,
      square_event_type: 'payment.reconciled',
    } }]);
  });

  it('bounds provider work to ten and reports fixed scan errors', async (t) => {
    const due = Array.from({ length: 25 }, (_, index) => card({ orderId: String(index) }));
    let active = 0;
    let peak = 0;
    const result = await expireDueSquareCardQuotes(emptyDb, square, new Date(), {
      load: async () => due,
      inspect: async () => {
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve)); active -= 1;
        return {
          kind: 'unpaid', squareOrderId: 'square-order-a', providerOrderVersion: 1,
          providerOrderState: 'CANCELED', squarePaymentId: null, providerPaymentState: null,
        };
      },
      expire: async () => true,
    });
    assert.equal(result.expired, 25);
    assert.equal(peak, 10);
    t.mock.method(console, 'error', () => {});
    const failed = await expireDueSquareCardQuotes(emptyDb, square, new Date(), {
      load: async () => { throw new Error('secret database detail'); },
    });
    assert.equal(failed.scanFailed, true);
  });
});
