import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildSquareLines,
  cancelOrder,
  createOrder,
  OrderError,
  orderRequestFingerprint,
  refundOrderPayment,
  totalExceedsApprovedMaximum,
  type CreateOrderInput,
} from './orders';
import type { RefundEventRecord } from './refunds';

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

const CREATE_INPUT: CreateOrderInput = {
  brandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  locationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  customerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  actorUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  fulfillmentType: 'pickup',
  scheduledFor: '2020-01-01T00:00:00.000Z',
  note: 'Leave room for cream',
  lines: [{
    itemSlug: 'drip-coffee',
    sizeSlug: 'large',
    quantity: 1,
    modifierSlugs: ['oat-milk'],
    note: 'Light roast',
  }],
  tipCents: 100,
  maximumTotalCents: 1_000,
  tenderType: 'pay_at_pickup',
  channel: 'web',
  guestLabel: 'Ada',
  deviceId: null,
  clientKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  taxJurisdictions: [{ id: 'state', label: 'State', rate: 0.03 }],
};

const COMMITTED_REPLAY = {
  order: {
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    status: 'created',
    subtotal_cents: 500,
    tax_cents: 15,
    tip_cents: 100,
    total_cents: 615,
    daily_number: 42,
  },
  replayed: true,
};

type ReplayRpcCall = { name: string; args: Record<string, unknown> };

function replayOnlyDatabase(
  data: unknown,
  error: { code: string; message: string } | null,
  calls: ReplayRpcCall[],
): SupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data, error };
    },
    from: () => {
      throw new Error('A replay must not read mutable order state.');
    },
  } as unknown as SupabaseClient;
}

describe('createOrder idempotency', () => {
  it('fingerprints immutable request input while excluding mutable tax configuration', () => {
    const fingerprint = orderRequestFingerprint(CREATE_INPUT);
    assert.match(fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(orderRequestFingerprint({
      ...CREATE_INPUT,
      taxJurisdictions: [{ id: 'city', label: 'City', rate: 0.09 }],
    }), fingerprint);
    assert.notEqual(orderRequestFingerprint({
      ...CREATE_INPUT,
      lines: CREATE_INPUT.lines.map((line) => ({ ...line, quantity: 2 })),
    }), fingerprint);
  });

  it('returns a lost-response winner before local time and mutable catalog validation', async () => {
    const calls: ReplayRpcCall[] = [];
    const result = await createOrder({
      db: replayOnlyDatabase(COMMITTED_REPLAY, null, calls),
    }, {
      ...CREATE_INPUT,
      // Pin that even locally invalid input cannot mask an exact committed
      // attempt after validation rules change between the first call/retry.
      lines: [],
      tipCents: -1,
    });

    assert.deepEqual(result, {
      orderId: COMMITTED_REPLAY.order.id,
      status: 'created',
      subtotalCents: 500,
      taxCents: 15,
      tipCents: 100,
      totalCents: 615,
      dailyNumber: 42,
      replayed: true,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, 'resolve_order_replay');
    assert.equal(calls[0]?.args.p_request_fingerprint,
      orderRequestFingerprint({ ...CREATE_INPUT, lines: [], tipCents: -1 }));
  });

  it('surfaces a mismatched same-key payload before reading mutable catalog state', async () => {
    const calls: ReplayRpcCall[] = [];
    await assert.rejects(createOrder({
      db: replayOnlyDatabase(null, {
        code: '22023',
        message: 'idempotency key was already used for a different order request',
      }, calls),
    }, CREATE_INPUT), (error: unknown) => {
      assert.ok(error instanceof OrderError);
      assert.equal(error.code, 'idempotency_conflict');
      return true;
    });
    assert.equal(calls.length, 1);
  });
});

const REFUND_KEY = '11111111-1111-4111-8111-111111111111';

class CompletedRefundQuery {
  constructor(private readonly table: string) {}
  select(): this { return this; }
  eq(): this { return this; }

  async maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
    const data = this.table === 'orders'
      ? {
          id: 'order-1', brand_id: 'brand-1', status: 'refunded', total_cents: 500,
          stored_value_applied_cents: 0, tender_type: 'square_card', square_payment_id: 'payment-1',
        }
      : {
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
    const db = { from: (table: string) => new CompletedRefundQuery(table) } as unknown as SupabaseClient;
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

type RefundClaimCall = { name: string; args: Record<string, unknown> };

class WebhookFirstOrderQuery {
  select(): this { return this; }
  eq(): this { return this; }

  async maybeSingle<T>(): Promise<{ data: T; error: null }> {
    return {
      data: {
        id: 'order-1', brand_id: 'brand-1', status: 'paid', total_cents: 500,
        stored_value_applied_cents: 0, tender_type: 'square_card', square_payment_id: 'payment-1',
      } as T,
      error: null,
    };
  }
}

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

  from(table: string): WebhookFirstOrderQuery | WebhookFirstRefundQuery {
    return table === 'orders' ? new WebhookFirstOrderQuery() : new WebhookFirstRefundQuery(this);
  }

  async rpc(name: string, args: Record<string, unknown>) {
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

class PaidCashCancellationQuery {
  insertCalls = 0;
  select(): this { return this; }
  eq(): this { return this; }
  insert(): this { this.insertCalls += 1; return this; }

  async maybeSingle<T>(): Promise<{ data: T; error: null }> {
    return {
      data: {
        id: 'order-1', brand_id: 'brand-1', customer_id: 'customer-1', status: 'paid',
        total_cents: 500, square_payment_id: null,
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
});
