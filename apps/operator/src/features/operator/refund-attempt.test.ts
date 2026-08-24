import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ApiError, AppNetworkError } from '@platform/api-client';

import {
  RefundAttemptError,
  refundFailureIsConclusive,
  runRefundAttempt,
  type RefundAttemptStorage,
} from './refund-attempt';

class MemoryStorage implements RefundAttemptStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

describe('runRefundAttempt', () => {
  it('reuses the durable key after an ambiguous network outcome', async () => {
    const storage = new MemoryStorage();
    const observed: string[] = [];
    await assert.rejects(
      runRefundAttempt(storage, { orderId: 'order-1', amountCents: 500 }, async (key) => {
        observed.push(key);
        throw new AppNetworkError('timeout', 'The response was lost.');
      }),
      AppNetworkError,
    );
    await runRefundAttempt(storage, { orderId: 'order-1', amountCents: 500 }, async (key) => {
      observed.push(key);
      return { ok: true };
    });
    assert.equal(observed.length, 2);
    assert.equal(observed[0], observed[1]);
  });

  it('clears a confirmed attempt so an intentional next refund gets a new key', async () => {
    const storage = new MemoryStorage();
    const observed: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await runRefundAttempt(storage, { orderId: 'order-1', amountCents: 500 }, async (key) => {
        observed.push(key);
        return { ok: true };
      });
    }
    assert.notEqual(observed[0], observed[1]);
  });

  it('clears a conclusive 4xx rejection but retains a 5xx attempt', async () => {
    const storage = new MemoryStorage();
    const keys: string[] = [];
    await assert.rejects(
      runRefundAttempt(storage, { orderId: 'order-1', amountCents: 'full' }, async (key) => {
        keys.push(key);
        throw new ApiError(400, 'invalid_request', 'Rejected.');
      }),
      ApiError,
    );
    await assert.rejects(
      runRefundAttempt(storage, { orderId: 'order-1', amountCents: 'full' }, async (key) => {
        keys.push(key);
        throw new ApiError(503, 'internal', 'Unknown outcome.');
      }),
      ApiError,
    );
    await runRefundAttempt(storage, { orderId: 'order-1', amountCents: 'full' }, async (key) => {
      keys.push(key);
      return { ok: true };
    });
    assert.notEqual(keys[0], keys[1]);
    assert.equal(keys[1], keys[2]);
  });

  it('blocks a changed amount while an ambiguous attempt remains', async () => {
    const storage = new MemoryStorage();
    await assert.rejects(
      runRefundAttempt(storage, { orderId: 'order-1', amountCents: 500 }, async () => {
        throw new AppNetworkError('request_failed', 'Unknown outcome.');
      }),
      AppNetworkError,
    );
    await assert.rejects(
      runRefundAttempt(storage, { orderId: 'order-1', amountCents: 600 }, async () => ({ ok: true })),
      (error: unknown) => error instanceof RefundAttemptError && error.code === 'amount_changed',
    );
  });
});

describe('refundFailureIsConclusive', () => {
  it('distinguishes fail-closed client errors from ambiguous transport failures', () => {
    assert.equal(refundFailureIsConclusive(
      new RefundAttemptError('storage_unavailable', 'No refund was sent.'),
    ), true);
    assert.equal(refundFailureIsConclusive(new ApiError(400, 'invalid_request', 'Rejected.')), true);
    assert.equal(refundFailureIsConclusive(new ApiError(503, 'internal', 'Unknown.')), false);
    assert.equal(refundFailureIsConclusive(new AppNetworkError('timeout', 'Unknown.')), false);
  });
});
