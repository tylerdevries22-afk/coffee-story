import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createOrder, OrderError, orderRequestFingerprint, type CreateOrderInput } from './orders';

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

