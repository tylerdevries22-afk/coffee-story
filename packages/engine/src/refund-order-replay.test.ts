import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { refundOrderPayment } from './orders';
import type { RefundEventRecord } from './refunds';

const REFUND_KEY = '11111111-1111-4111-8111-111111111111';

class CompletedRefundQuery {
  select(): this { return this; }
  eq(): this { return this; }

  async maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
    const data = {
      brand_id: 'brand-1', order_id: 'order-1', square_refund_id: 'refund-1',
      refund_cents: 500, refund_request_key: REFUND_KEY,
      snapshot: {
        refund_id: 'refund-1', amount_cents: 500, requested_amount: 'full', request_key: REFUND_KEY,
      },
    } satisfies RefundEventRecord;
    return { data: data as T, error: null };
  }
}

describe('refundOrderPayment replay', () => {
  it('returns a completed full refund before terminal status and balance checks', async () => {
    const db = {
      from: () => new CompletedRefundQuery(),
      // Already fully refunded: `begin_order_refund` reports a balance of
      // zero left. Only the request-key replay match, checked before that
      // balance is, keeps this from throwing 'refund_unavailable'.
      async rpc(name: string) {
        if (name === 'begin_order_refund') {
          return {
            data: [{
              brand_id: 'brand-1', status: 'refunded', total_cents: 500,
              stored_value_applied_cents: 0, square_payment_id: 'payment-1',
              already_refunded_cents: 500,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('Square must not be called for a completed attempt.'); };
    try {
      const result = await refundOrderPayment({
        db,
        square: { env: 'sandbox', applicationId: 'app', applicationSecret: 'secret' },
        locationAccessToken: 'location-token',
      }, {
        orderId: 'order-1', amountCents: 'full', reason: 'Guest request',
        actorUserId: 'staff-1', requestKey: REFUND_KEY,
      });
      assert.deepEqual(result, { orderId: 'order-1', refundId: 'refund-1', amountCents: 500 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

