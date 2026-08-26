import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { QueuedTransition } from './offline-queue';
import { enqueueTransition } from './offline-queue';
import {
  drainTransitionQueue, enqueueSharedTransition, finalizeTransitionDrain, loadTransitionQueue,
  QueueOperationTimeoutError, refreshTransitionStatuses, runQueueOperation,
  saveTransitionQueue, transitionQueueNeedsRefresh, type QueueStorage,
} from './persistent-queue';

class MemoryStorage implements QueueStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

const intent: QueuedTransition = {
  orderId: 'order-1', to: 'ready', queuedAt: '2026-08-24T12:00:00Z',
};

describe('persistent transition queue', () => {
  it('survives a process restart, drains in state-machine order, then clears storage', async () => {
    const storage = new MemoryStorage();
    assert.equal(await saveTransitionQueue(storage, 'location-1', [intent]), true);
    const rehydrated = await loadTransitionQueue(storage, 'location-1');
    assert.deepEqual(rehydrated, [intent]);

    const applied: string[] = [];
    const drained = await drainTransitionQueue(
      rehydrated,
      new Map([['order-1', 'paid']] as const),
      async (transition) => {
        applied.push(transition.to);
        return { outcome: 'confirmed' };
      },
    );
    assert.deepEqual(applied, ['in_progress', 'ready']);
    assert.deepEqual(drained.remaining, []);
    assert.equal(await saveTransitionQueue(storage, 'location-1', drained.remaining), true);
    assert.deepEqual(await loadTransitionQueue(storage, 'location-1'), []);
  });

  it('removes a persisted intent the server already applied without inserting again', async () => {
    let calls = 0;
    const drained = await drainTransitionQueue(
      [intent],
      new Map([['order-1', 'ready']] as const),
      async () => { calls += 1; return { outcome: 'confirmed' }; },
    );
    assert.equal(calls, 0);
    assert.deepEqual(drained, { remaining: [], conflicts: [] });
  });

  it('keeps the original target after a network failure and rejects corrupt storage', async () => {
    const drained = await drainTransitionQueue(
      [intent],
      new Map([['order-1', 'paid']] as const),
      async () => ({ outcome: 'retry' }),
    );
    assert.deepEqual(drained.remaining, [intent]);

    const storage = new MemoryStorage();
    storage.values.set('platform:operator-transition-queue:location-1', '{bad');
    assert.deepEqual(await loadTransitionQueue(storage, 'location-1'), []);
  });

  it('preserves a newer decision queued while an older intent drains', async () => {
    let current = [intent];
    const started = current;
    const drained = await drainTransitionQueue(
      started,
      new Map([['order-1', 'paid']] as const),
      async () => {
        current = enqueueTransition(current, {
          orderId: 'order-1', to: 'picked_up', queuedAt: '2026-08-24T12:01:00Z',
        });
        return { outcome: 'confirmed' };
      },
    );
    current = finalizeTransitionDrain(current, started, drained.remaining);
    assert.deepEqual(current, [{
      orderId: 'order-1', to: 'picked_up', queuedAt: '2026-08-24T12:01:00Z',
    }]);
  });

  it('requires a fresh board before draining an intent queued for a concurrent arrival', async () => {
    let current = [intent];
    const started = current;
    const knownStatus = new Map([['order-1', 'paid' as const]]);
    const drained = await drainTransitionQueue(started, knownStatus, async () => {
      current = enqueueTransition(current, {
        orderId: 'order-2', to: 'in_progress', queuedAt: '2026-08-24T12:01:00Z',
      });
      return { outcome: 'confirmed' };
    });
    current = finalizeTransitionDrain(current, started, drained.remaining);

    assert.equal(transitionQueueNeedsRefresh(current), true);
    knownStatus.set('order-2', 'paid');
    assert.equal(transitionQueueNeedsRefresh(current), true);
    const concurrentDrain = await drainTransitionQueue(current, knownStatus, async () => ({
      outcome: 'confirmed',
    }));
    assert.deepEqual(concurrentDrain, { remaining: [], conflicts: [] });
  });

  it('retains an unknown queued order when its refresh is offline', async () => {
    const status = new Map<string, 'paid'>();
    assert.equal(await refreshTransitionStatuses([intent], status, async () => {
      throw new Error('offline');
    }), null);
    assert.deepEqual([...status], []);
  });

  it('refreshes a known order before draining a concurrent transition', async () => {
    let loads = 0;
    const status = await refreshTransitionStatuses(
      [intent],
      new Map([['order-1', 'paid']] as const),
      async () => {
        loads += 1;
        return [{ id: 'order-1', status: 'in_progress' as const }];
      },
    );
    assert.equal(loads, 1);
    assert.equal(status?.get('order-1'), 'in_progress');
    const applied: string[] = [];
    const drained = await drainTransitionQueue([intent], status ?? new Map(), async (transition) => {
      applied.push(transition.to);
      return { outcome: 'confirmed' };
    });
    assert.deepEqual(applied, ['ready']);
    assert.deepEqual(drained, { remaining: [], conflicts: [] });
  });

  it('aborts a hung operation and releases the caller by its deadline', async () => {
    let aborted = false;
    await assert.rejects(
      runQueueOperation((signal) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        }, { once: true });
      }), 5),
      QueueOperationTimeoutError,
    );
    assert.equal(aborted, true);
  });

  it('keeps a broker intent untouched when staff also advances a fixture order', () => {
    assert.deepEqual(enqueueSharedTransition([intent], {
      orderId: 'fixture-1', to: 'in_progress', queuedAt: '2026-08-24T12:01:00Z',
    }, false), [intent]);
    assert.deepEqual(enqueueSharedTransition([intent], {
      orderId: 'order-2', to: 'in_progress', queuedAt: '2026-08-24T12:01:00Z',
    }, true).map((entry) => entry.orderId), ['order-1', 'order-2']);
  });
});
