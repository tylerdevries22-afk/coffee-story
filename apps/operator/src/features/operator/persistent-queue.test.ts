import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { QueuedTransition } from './offline-queue';
import {
  drainTransitionQueue, loadTransitionQueue, saveTransitionQueue, type QueueStorage,
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
    storage.values.set('coffee-story:operator-transition-queue:location-1', '{bad');
    assert.deepEqual(await loadTransitionQueue(storage, 'location-1'), []);
  });
});
