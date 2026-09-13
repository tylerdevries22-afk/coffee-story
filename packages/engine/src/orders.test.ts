import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { buildSquareLines, cancelOrder, OrderError, totalExceedsApprovedMaximum } from './orders';

describe('buildSquareLines', () => {
  it('folds options into the name and stringifies quantity, integer cents', () => {
    assert.deepEqual(buildSquareLines([
      { name: 'Oat Latte', quantity: 2, unitPriceCents: 625, options: ['16 oz', 'Iced'] },
      { name: 'Croissant', quantity: 1, unitPriceCents: 450, options: [] },
    ]), [
      { name: 'Oat Latte (16 oz, Iced)', quantity: '2', base_price_money: { amount: 625, currency: 'USD' } },
      { name: 'Croissant', quantity: '1', base_price_money: { amount: 450, currency: 'USD' } },
    ]);
  });

  it('carries a structured pack recipe into the processor line note', () => {
    assert.deepEqual(buildSquareLines([{
      name: 'Brew Box', quantity: 2, unitPriceCents: 2200, options: [],
      packContents: [{ name: 'Ethiopia', quantity: 3 }, { name: 'Kenya', quantity: 1 }],
    }]), [{
      name: 'Brew Box',
      quantity: '2',
      base_price_money: { amount: 2200, currency: 'USD' },
      note: 'Inside each pack: 3x Ethiopia, 1x Kenya',
    }]);
  });
});

describe('totalExceedsApprovedMaximum', () => {
  it('rejects only a server-side increase above the amount the guest saw', () => {
    assert.equal(totalExceedsApprovedMaximum(1_001, 1_000), true);
    assert.equal(totalExceedsApprovedMaximum(1_000, 1_000), false);
    assert.equal(totalExceedsApprovedMaximum(999, 1_000), false);
    assert.equal(totalExceedsApprovedMaximum(5_000), false);
  });
});

class PaidCashCancellationQuery {
  insertCalls = 0;
  select(): this { return this; }
  eq(): this { return this; }
  insert(): this { this.insertCalls += 1; return this; }

  async maybeSingle<T>(): Promise<{ data: T; error: null }> {
    return {
      data: {
        id: 'order-1', brand_id: 'brand-1', customer_id: 'customer-1', status: 'paid',
        tender_type: 'pay_at_pickup', total_cents: 500, square_payment_id: null,
      } as T,
      error: null,
    };
  }
}

describe('cancelOrder', () => {
  it('refuses a paid non-Square order instead of cancelling collected money', async () => {
    const query = new PaidCashCancellationQuery();
    const db = { from: () => query } as unknown as SupabaseClient;
    await assert.rejects(
      cancelOrder({ db }, {
        orderId: 'order-1', customerId: 'customer-1', actorUserId: 'user-1', reason: 'Changed mind',
      }),
      (error: unknown) => error instanceof OrderError && error.code === 'cancel_unavailable',
    );
    assert.equal(query.insertCalls, 0);
  });

  it('refuses a hosted checkout that can still settle without a payment id', async () => {
    const query = new PaidCashCancellationQuery();
    query.maybeSingle = async <T>() => ({
      data: {
        id: 'order-1', brand_id: 'brand-1', customer_id: 'customer-1', status: 'created',
        tender_type: 'square_link', total_cents: 500, square_payment_id: null,
      } as T,
      error: null,
    });
    const db = { from: () => query } as unknown as SupabaseClient;
    await assert.rejects(cancelOrder({ db }, {
      orderId: 'order-1', customerId: 'customer-1', actorUserId: 'user-1', reason: 'Changed mind',
    }), (error: unknown) => error instanceof OrderError && error.code === 'cancel_unavailable');
    assert.equal(query.insertCalls, 0);
  });
});
