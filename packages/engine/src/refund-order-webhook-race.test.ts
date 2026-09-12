import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { refundOrderPayment } from './orders';
import type { RefundEventRecord } from './refunds';

const REFUND_KEY = '11111111-1111-4111-8111-111111111111';

type RefundClaimCall = { name: string; args: Record<string, unknown> };

class WebhookFirstRefundQuery {
  private readonly filters = new Map<string, unknown>();

  constructor(private readonly database: WebhookFirstRefundDatabase) {}
  select(): this { return this; }
  eq(column: string, value: unknown): this { this.filters.set(column, value); return this; }

  async maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
    const requestKey = this.filters.get('refund_request_key');
    const squareRefundId = this.filters.get('square_refund_id');
    const event = requestKey !== undefined
      ? this.database.refundEvent.refund_request_key === requestKey ? this.database.refundEvent : null
      : squareRefundId === this.database.refundEvent.square_refund_id ? this.database.refundEvent : null;
    return { data: event as T | null, error: null };
  }

  async returns<T>(): Promise<{ data: T; error: null }> {
    return { data: [] as T, error: null };
  }

  async insert(row: unknown): Promise<{ data: null; error: { code: string; message: string } }> {
    this.database.insertCalls.push(row);
    return {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    };
  }
}

class WebhookFirstRefundDatabase {
  readonly claimCalls: RefundClaimCall[] = [];
  readonly insertCalls: unknown[] = [];
  refundEvent: RefundEventRecord = {
    brand_id: 'brand-1',
    order_id: 'order-1',
    square_refund_id: 'refund-1',
    refund_cents: 500,
    refund_request_key: null,
    snapshot: {
      square_event: 'refund.updated',
      square_event_id: 'event-1',
      square_refund_id: 'refund-1',
      refunded_cents: 500,
    },
  };

  from(): WebhookFirstRefundQuery {
    return new WebhookFirstRefundQuery(this);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'begin_order_refund') {
      return {
        data: [{
          brand_id: 'brand-1', status: 'paid', total_cents: 500,
          stored_value_applied_cents: 0, square_payment_id: 'payment-1',
          already_refunded_cents: 0,
        }],
        error: null,
      };
    }
    if (name === 'end_order_refund') return { data: true, error: null };
    this.claimCalls.push({ name, args });
    const requestKey = args.p_refund_request_key;
    const requestedAmount = args.p_requested_amount;
    if (typeof requestKey !== 'string' || (requestedAmount !== 'full' && typeof requestedAmount !== 'number')) {
      return { data: null, error: { code: '22023', message: 'invalid refund claim' } };
    }
    this.refundEvent = {
      ...this.refundEvent,
      refund_request_key: requestKey,
      snapshot: {
        ...this.refundEvent.snapshot,
        request_key: requestKey,
        requested_amount: requestedAmount,
      },
    };
    return { data: this.refundEvent, error: null };
  }
}

describe('refundOrderPayment webhook race', () => {
  it('atomically claims a webhook-first winner and resolves a later same-key retry', async () => {
    const database = new WebhookFirstRefundDatabase();
    const db = database as unknown as SupabaseClient;
    const originalFetch = globalThis.fetch;
    let squareCalls = 0;
    globalThis.fetch = async (_input, init) => {
      squareCalls += 1;
      const body = JSON.parse(String(init?.body)) as { idempotency_key?: unknown };
      assert.equal(body.idempotency_key, `refund-${REFUND_KEY}`);
      return new Response(JSON.stringify({ refund: { id: 'refund-1', status: 'PENDING' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    try {
      const input = {
        orderId: 'order-1', amountCents: 'full' as const, reason: 'Guest request',
        actorUserId: 'staff-1', requestKey: REFUND_KEY,
      };
      const dependencies = {
        db,
        square: { env: 'sandbox' as const, applicationId: 'app', applicationSecret: 'secret' },
        locationAccessToken: 'location-token',
      };
      assert.deepEqual(await refundOrderPayment(dependencies, input), {
        orderId: 'order-1', refundId: 'refund-1', amountCents: 500,
      });
      assert.deepEqual(await refundOrderPayment(dependencies, input), {
        orderId: 'order-1', refundId: 'refund-1', amountCents: 500,
      });
      assert.equal(squareCalls, 1);
      assert.equal(database.insertCalls.length, 1);
      assert.deepEqual(database.claimCalls, [{
        name: 'claim_refund_request',
        args: {
          p_brand_id: 'brand-1',
          p_order_id: 'order-1',
          p_square_refund_id: 'refund-1',
          p_refund_cents: 500,
          p_refund_request_key: REFUND_KEY,
          p_requested_amount: 'full',
        },
      }]);
      assert.deepEqual(database.refundEvent.snapshot, {
        square_event: 'refund.updated',
        square_event_id: 'event-1',
        square_refund_id: 'refund-1',
        refunded_cents: 500,
        request_key: REFUND_KEY,
        requested_amount: 'full',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/** Every table this claim scenario touches: never a match, just a sink for inserts. */
