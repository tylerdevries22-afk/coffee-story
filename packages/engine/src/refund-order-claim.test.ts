import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { OrderError, refundOrderPayment } from './orders';
import type { RefundEventRecord } from './refunds';

class ClaimedRefundTableQuery {
  constructor(private readonly database: ClaimedRefundDatabase) {}
  select(): this { return this; }
  eq(): this { return this; }
  async maybeSingle<T>(): Promise<{ data: T | null; error: null }> { return { data: null, error: null }; }

  async insert(row: unknown): Promise<{ error: null }> {
    this.database.events.push(row as RefundEventRecord);
    return { error: null };
  }
}

/**
 * A minimal in-memory `orders` + `order_events` pair that actually models
 * `begin_order_refund` / `end_order_refund`'s claim semantics, so these
 * tests exercise the real race rather than a canned response.
 */
class ClaimedRefundDatabase {
  order = {
    brand_id: 'brand-1', status: 'paid', total_cents: 2_000, stored_value_applied_cents: 0,
    square_payment_id: 'payment-1',
    refundClaimedBy: null as string | null,
  };

  events: RefundEventRecord[] = [];

  from(): ClaimedRefundTableQuery {
    return new ClaimedRefundTableQuery(this);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    const requestKey = args.p_request_key as string;
    if (name === 'begin_order_refund') {
      if (this.order.refundClaimedBy !== null && this.order.refundClaimedBy !== requestKey) {
        return { data: null, error: { code: '22023', message: 'refund_attempt_in_progress' } };
      }
      this.order.refundClaimedBy = requestKey;
      const alreadyRefundedCents = this.events.reduce((sum, event) => sum + (event.refund_cents ?? 0), 0);
      return {
        data: [{ ...this.order, already_refunded_cents: alreadyRefundedCents }],
        error: null,
      };
    }
    if (name === 'end_order_refund') {
      if (this.order.refundClaimedBy === requestKey) this.order.refundClaimedBy = null;
      return { data: true, error: null };
    }
    return { data: null, error: null }; // record_platform_fee_refund: no fee row to reverse.
  }
}

const SANDBOX_SQUARE = { env: 'sandbox' as const, applicationId: 'app', applicationSecret: 'secret' };

function mockSquareRefunds(): void {
  let sequence = 0;
  globalThis.fetch = async () => {
    sequence += 1;
    return new Response(JSON.stringify({ refund: { id: `refund-${sequence}`, status: 'PENDING' } }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('refundOrderPayment concurrency claim', () => {
  it('refuses a second attempt while the first still holds the claim', async () => {
    const database = new ClaimedRefundDatabase();
    const db = database as unknown as SupabaseClient;
    const originalFetch = globalThis.fetch;
    mockSquareRefunds();
    try {
      const dependencies = { db, square: SANDBOX_SQUARE, locationAccessToken: 'token' };
      // Neither call is awaited before the other starts: calling an async
      // function only runs synchronously up to its first `await`, and
      // `begin_order_refund`'s claim write happens inside that first
      // `await` -- so starting the second call here, before yielding back
      // to the event loop, is what puts it up against the first's claim
      // rather than a snapshot taken before the first existed.
      const first = refundOrderPayment(dependencies, {
        orderId: 'order-1', amountCents: 1_500, reason: 'Guest request',
        actorUserId: 'staff-1', requestKey: 'request-a',
      });
      const second = refundOrderPayment(dependencies, {
        orderId: 'order-1', amountCents: 500, reason: 'Guest request',
        actorUserId: 'staff-2', requestKey: 'request-b',
      });
      await assert.rejects(second,
        (error: unknown) => error instanceof OrderError && error.code === 'refund_unavailable');
      assert.equal((await first).amountCents, 1_500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('a later attempt sees the amount the first attempt recorded, not a stale zero', async () => {
    const database = new ClaimedRefundDatabase();
    const db = database as unknown as SupabaseClient;
    const originalFetch = globalThis.fetch;
    mockSquareRefunds();
    try {
      const dependencies = { db, square: SANDBOX_SQUARE, locationAccessToken: 'token' };
      const first = await refundOrderPayment(dependencies, {
        orderId: 'order-1', amountCents: 1_500, reason: 'Guest request',
        actorUserId: 'staff-1', requestKey: 'request-a',
      });
      assert.equal(first.amountCents, 1_500);
      // The claim is released once the first attempt finishes, so this one
      // is admitted — but `begin_order_refund` recomputes already-refunded
      // cents from `order_events` fresh, so it sees the $15 the first
      // attempt just recorded rather than the order's original $20.
      const second = await refundOrderPayment(dependencies, {
        orderId: 'order-1', amountCents: 'full', reason: 'Guest request',
        actorUserId: 'staff-2', requestKey: 'request-b',
      });
      assert.equal(second.amountCents, 500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

