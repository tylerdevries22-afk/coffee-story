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

  /**
   * The engine guard normally refuses first, so this is the race: the
   * installation is disabled between that read and the insert. Without the
   * mapping the trigger's 42501 escapes as a raw Postgres error and the guest
   * gets a crash where the identical refusal a moment earlier was a sentence.
   */
  it('answers the fulfillment trigger with the same code the engine guard uses', async () => {
    const calls: ReplayRpcCall[] = [];
    await assert.rejects(createOrder({
      db: replayOnlyDatabase(null, {
        code: '42501',
        message: 'fulfillment capability commerce-delivery is not installed for this brand',
      }, calls),
    }, CREATE_INPUT), (error: unknown) => {
      assert.ok(error instanceof OrderError);
      assert.equal(error.code, 'fulfillment_unavailable');
      return true;
    });
    assert.equal(calls.length, 1);
  });

  /**
   * 42501 is also plain RLS. Mapping the class rather than the message would
   * tell a guest their brand lacks a capability when the real answer is that
   * the caller was not allowed to read the row at all.
   */
  it('leaves an unrelated insufficient-privilege error alone', async () => {
    const calls: ReplayRpcCall[] = [];
    await assert.rejects(createOrder({
      db: replayOnlyDatabase(null, {
        code: '42501',
        message: 'permission denied for table orders',
      }, calls),
    }, CREATE_INPUT), (error: unknown) => {
      assert.equal(error instanceof OrderError, false);
      return true;
    });
    assert.equal(calls.length, 1);
  });
});

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
