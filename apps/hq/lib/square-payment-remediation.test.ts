import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  encryptToken, loadTokenKey, SquareApiError, type SquareConfig,
} from '@platform/engine';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  remediateDueSquarePayments, type DuePaymentRemediation,
} from './square-payment-remediation';

const ORDER = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const LOCATION = '33333333-3333-4333-8333-333333333333';
const GENERATION = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-08T18:00:00.000Z');
const square: SquareConfig = {
  env: 'sandbox', applicationId: 'app', applicationSecret: 'secret',
  apiBase: 'https://square.example.test',
};
const emptyDb = {} as SupabaseClient;

function due(over: Partial<DuePaymentRemediation> = {}): DuePaymentRemediation {
  return {
    orderId: ORDER, brandId: BRAND, locationId: LOCATION,
    squareOrderId: 'square-order', squarePaymentId: 'square-payment',
    refundAmountCents: 1_000, refundRequestKey: ORDER,
    squareRefundId: null, providerRefundStatus: null,
    attemptCount: 1, claimGeneration: GENERATION,
    accessTokenEncrypted: encryptToken('access-token', loadTokenKey()), ...over,
  };
}

describe('late Square payment remediation', () => {
  beforeEach(() => {
    process.env.SQUARE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  });
  afterEach(() => { delete process.env.SQUARE_TOKEN_KEY; });

  it('claims, issues the exact permanent-key refund, and completes its lease', async (t) => {
    const oldKey = process.env.SQUARE_TOKEN_KEY;
    process.env.SQUARE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
    t.after(() => { if (oldKey === undefined) delete process.env.SQUARE_TOKEN_KEY;
      else process.env.SQUARE_TOKEN_KEY = oldKey; });
    const encrypted = encryptToken('access-token', loadTokenKey());
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const claim = {
      order_id: ORDER, brand_id: BRAND, location_id: LOCATION,
      square_order_id: 'square-order', square_payment_id: 'square-payment',
      refund_amount_cents: 1_000, refund_request_key: ORDER,
      square_refund_id: null, provider_refund_status: null,
      attempt_count: 1, claim_generation: GENERATION,
    };
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return name === 'claim_due_square_payment_remediations'
          ? { data: [claim], error: null } : { data: true, error: null };
      },
      from: () => ({ select() { return this; }, in() { return this; },
        async returns<T>() { return { data: [{ brand_id: BRAND, location_id: LOCATION,
          access_token_encrypted: encrypted }] as T, error: null }; } }),
    } as unknown as SupabaseClient;
    const requests: Record<string, unknown>[] = [];
    t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (requests.length === 1) return Response.json({}, { status: 503 });
      return Response.json({ refund: {
        id: 'square-refund', payment_id: 'square-payment', status: 'COMPLETED',
        amount_money: { amount: 1_000, currency: 'USD' },
      } });
    });

    const result = await remediateDueSquarePayments(db, square, NOW);

    assert.deepEqual(result,
      { scanned: 1, completed: 1, pending: 0, manual: 0, failed: 0, stale: 0, scanFailed: false });
    const expectedRequest = {
      idempotency_key: `refund-${ORDER}`, payment_id: 'square-payment',
      amount_money: { amount: 1_000, currency: 'USD' },
      reason: 'Automatic reversal of a late payment',
    };
    assert.deepEqual(requests, [expectedRequest, expectedRequest]);
    assert.deepEqual(calls.at(-1), { name: 'finalize_square_payment_remediation', args: {
      p_order_id: ORDER, p_claim_generation: GENERATION,
      p_square_refund_id: 'square-refund', p_provider_refund_status: 'COMPLETED',
      p_provider_payment_id: 'square-payment',
      p_provider_refund_amount_cents: 1_000, p_provider_refund_currency: 'USD',
    } });
  });

  it('retrieves a known pending refund and persists its current provider status', async (t) => {
    const row = due({ squareRefundId: 'refund-a', providerRefundStatus: 'PENDING' });
    let finalized: unknown;
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), 'https://square.example.test/v2/refunds/refund-a');
      assert.equal(init?.method, 'GET');
      return Response.json({ refund: { id: 'refund-a', payment_id: row.squarePaymentId,
        status: 'PENDING', amount_money: { amount: row.refundAmountCents, currency: 'USD' } } });
    });
    const result = await remediateDueSquarePayments(emptyDb, square, NOW, {
      load: async () => [row],
      finalize: async (_db, _row, refund) => { finalized = refund; return true; },
    });
    assert.deepEqual(finalized, {
      id: 'refund-a', status: 'PENDING', paymentId: 'square-payment',
      amountCents: 1_000, currency: 'USD',
    });
    assert.equal(result.pending, 1);
  });

  it('durably records terminal provider failures for manual action', async () => {
    const row = due();
    let finalized: unknown;
    const result = await remediateDueSquarePayments(emptyDb, square, NOW, {
      load: async () => [row],
      refund: async () => ({ refund: { id: 'refund-failed', payment_id: row.squarePaymentId,
        status: 'FAILED', amount_money: { amount: row.refundAmountCents, currency: 'USD' } } }),
      finalize: async (_db, _row, refund) => { finalized = refund; return true; },
    });
    assert.deepEqual(finalized, {
      id: 'refund-failed', status: 'FAILED', paymentId: 'square-payment',
      amountCents: 1_000, currency: 'USD',
    });
    assert.equal(result.manual, 1);
    assert.equal(result.failed, 0);
  });

  it('fences mismatched receipts and schedules bounded exponential retry', async () => {
    const failures: unknown[] = [];
    const row = due({ squareRefundId: 'refund-a', providerRefundStatus: 'PENDING', attemptCount: 4 });
    const result = await remediateDueSquarePayments(emptyDb, square, NOW, {
      load: async () => [row],
      retrieve: async () => ({ refund: { id: 'refund-b', payment_id: row.squarePaymentId,
        status: 'COMPLETED', amount_money: { amount: row.refundAmountCents, currency: 'USD' } } }),
      fail: async (_db, _row, code, retryAt) => { failures.push({ code, retryAt }); return true; },
    });
    assert.deepEqual(failures,
      [{ code: 'square_refund_invalid', retryAt: '2026-09-08T18:40:00.000Z' }]);
    assert.equal(result.failed, 1);
  });

  it('classifies definitive provider rejection without exposing its body', async () => {
    let code = '';
    const result = await remediateDueSquarePayments(emptyDb, square, NOW, {
      load: async () => [due()],
      refund: async () => { throw new SquareApiError('raw provider detail', 400, { secret: true }); },
      fail: async (_db, _row, value) => { code = value; return true; },
    });
    assert.equal(code, 'square_refund_rejected');
    assert.equal(result.failed, 1);
  });

  it('fences a missing connection failure with the current lease', async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => {
      calls.push({ name, args }); return { data: true, error: null };
    } } as unknown as SupabaseClient;
    const row = due({ accessTokenEncrypted: null, attemptCount: 2 });
    const result = await remediateDueSquarePayments(db, square, NOW, { load: async () => [row] });
    assert.equal(result.failed, 1);
    assert.deepEqual(calls, [{ name: 'fail_square_payment_remediation', args: {
      p_order_id: ORDER, p_claim_generation: GENERATION,
      p_error_code: 'square_connection_missing', p_retry_at: '2026-09-08T18:10:00.000Z',
    } }]);
  });

  it('bounds provider concurrency to five and reports stale finalizers', async () => {
    let active = 0;
    let peak = 0;
    const rows = Array.from({ length: 12 }, (_, index) => due({
      orderId: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      refundRequestKey: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    }));
    const result = await remediateDueSquarePayments(emptyDb, square, NOW, {
      load: async () => rows,
      refund: async (_config, _token, row) => {
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve)); active -= 1;
        return { refund: { id: `refund-${row.orderId}`, payment_id: row.squarePaymentId,
          status: 'COMPLETED', amount_money: { amount: row.refundAmountCents, currency: 'USD' } } };
      },
      finalize: async () => false,
    });
    assert.equal(peak, 5);
    assert.equal(result.stale, 12);
  });
});
