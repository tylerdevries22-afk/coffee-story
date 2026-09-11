import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SquareApiError, type SquareConfig } from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import { expireDueSquareCheckoutLinks, type DueSquareLink } from './square-link-maintenance';

const db = {} as SupabaseClient;
const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
};
const evidence = {
  kind: 'cancelled' as const, providerOrderVersion: 4, providerOrderState: 'CANCELED' as const,
};
const row = (id: string): DueSquareLink => ({
  order_id: id,
  brand_id: 'brand-a',
  location_id: 'location-a',
  expires_at: '2026-09-08T00:00:00.000Z',
  claim_generation: `claim-${id}`,
  checkoutUrl: `https://checkout.example/${id}`,
  paymentLinkId: `link-${id}`,
  squareOrderId: `square-order-${id}`,
  squareLocationId: 'square-location',
  accessTokenEncrypted: 'ciphertext',
  grossCents: 1_000,
  expectedFeeCents: 30,
  feeBpsApplied: 300,
  valid: true,
});

describe('Square checkout link expiry', () => {
  it('claims no more than fifty rows for one scheduled tick', async () => {
    const calls: unknown[] = [];
    const claimDb = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;
    const now = new Date('2026-09-08T15:30:00.000Z');
    const result = await expireDueSquareCheckoutLinks(claimDb, square, now);
    assert.deepEqual(calls, [{
      name: 'claim_due_square_checkout_quotes',
      args: { p_now: now.toISOString(), p_limit: 50 },
    }]);
    assert.equal(result.scanned, 0);
  });

  it('confirms provider deletion before releasing each reservation', async () => {
    const calls: string[] = [];
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one'), row('two')],
      inspect: async (_config, link) => { calls.push(`cancel:${link.order_id}`); return evidence; },
      finalize: async (_db, link) => {
        calls.push(`finalize:${link.order_id}`);
        return true;
      },
    });
    assert.deepEqual(result,
      { scanned: 2, cancelled: 2, reconciled: 0, failed: 0, stale: 0, scanFailed: false });
    for (const id of ['one', 'two']) {
      assert.ok(calls.indexOf(`cancel:${id}`) < calls.indexOf(`finalize:${id}`));
    }
  });

  it('processes one claimed batch with at most ten provider calls at once', async () => {
    const due = Array.from({ length: 50 }, (_, index) => row(String(index).padStart(2, '0')));
    let loads = 0;
    let active = 0;
    let peak = 0;
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => { loads += 1; return due; },
      inspect: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return evidence;
      },
      finalize: async () => true,
    });
    assert.equal(loads, 1);
    assert.equal(peak, 10);
    assert.deepEqual(result,
      { scanned: 50, cancelled: 50, reconciled: 0, failed: 0, stale: 0, scanFailed: false });
  });

  it('keeps capacity when Square rejects cancellation', async () => {
    let finalized = false;
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')],
      inspect: async () => { throw new SquareApiError('busy', 503, {}); },
      finalize: async () => { finalized = true; return true; },
    });
    assert.equal(finalized, false);
    assert.deepEqual(result,
      { scanned: 1, cancelled: 0, reconciled: 0, failed: 1, stale: 0, scanFailed: false });
  });

  it('finishes a retry only after Square proves the order was cancelled', async () => {
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')],
      inspect: async () => evidence,
      finalize: async () => true,
    });
    assert.equal(result.cancelled, 1);
  });

  it('fences final cleanup with the lease and both provider identities', async () => {
    const calls: unknown[] = [];
    const finalizeDb = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: true, error: null };
      },
    } as unknown as SupabaseClient;
    const due = row('one');
    const result = await expireDueSquareCheckoutLinks(finalizeDb, square, new Date(), {
      load: async () => [due], inspect: async () => evidence,
    });
    assert.equal(result.cancelled, 1);
    assert.deepEqual(calls, [{ name: 'expire_square_checkout_quote', args: {
      p_order_id: due.order_id, p_claim_generation: due.claim_generation,
      p_payment_link_id: due.paymentLinkId, p_square_order_id: due.squareOrderId,
      p_provider_order_version: 4, p_provider_order_state: 'CANCELED',
    } }]);
  });

  it('does not expire local state when Square cannot prove cancellation', async () => {
    let finalized = false;
    const result = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')],
      inspect: async () => { throw new Error('provider state is not terminal'); },
      finalize: async () => { finalized = true; return true; },
    });
    assert.equal(finalized, false);
    assert.equal(result.failed, 1);
  });

  it('reconciles completed hosted payments through the safe settlement RPC', async () => {
    const calls: unknown[] = [];
    const settlementDb = { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args }); return { data: false, error: null };
    } } as unknown as SupabaseClient;
    const due = row('one');
    const result = await expireDueSquareCheckoutLinks(settlementDb, square, new Date(), {
      load: async () => [due],
      inspect: async () => ({ kind: 'payment', paymentId: 'payment-a', feeCents: 30 }),
    });
    assert.equal(result.reconciled, 1);
    assert.deepEqual(calls, [{ name: 'record_square_payment_settlement', args: {
      target_order: due.order_id, square_event: 'reconcile:payment-a',
      square_order: due.squareOrderId, square_payment: 'payment-a',
      settled_fee_cents: 30, square_event_type: 'payment.reconciled',
    } }]);
  });

  it('surfaces stale database state and scan failures', async () => {
    const stale = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => [row('one')], inspect: async () => evidence, finalize: async () => false,
    });
    assert.equal(stale.stale, 1);
    const failed = await expireDueSquareCheckoutLinks(db, square, new Date(), {
      load: async () => { throw new Error('offline'); },
    });
    assert.equal(failed.scanFailed, true);
  });
});
