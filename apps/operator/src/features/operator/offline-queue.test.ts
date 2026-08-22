import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { enqueueTransition, reconcileQueue, type QueuedTransition } from './offline-queue';

const t = (orderId: string, to: QueuedTransition['to']): QueuedTransition =>
  ({ orderId, to, queuedAt: '2026-08-22T12:00:00Z' });

describe('enqueueTransition', () => {
  it('keeps one pending move per order, the newest', () => {
    let queue = enqueueTransition([], t('a', 'in_progress'));
    queue = enqueueTransition(queue, t('b', 'in_progress'));
    queue = enqueueTransition(queue, t('a', 'ready'));
    assert.deepEqual(queue.map((entry) => [entry.orderId, entry.to]), [['b', 'in_progress'], ['a', 'ready']]);
  });
});

describe('reconcileQueue', () => {
  it('applies moves the server state still allows', () => {
    const result = reconcileQueue(
      [t('a', 'ready'), t('b', 'in_progress')],
      new Map([['a', 'in_progress'], ['b', 'paid']] as const),
    );
    assert.deepEqual(result.apply.map((entry) => entry.orderId), ['a', 'b']);
    assert.equal(result.conflicts.length, 0);
  });

  it('drops a move the server already made, silently', () => {
    const result = reconcileQueue([t('a', 'ready')], new Map([['a', 'ready']] as const));
    assert.equal(result.apply.length, 0);
    assert.equal(result.conflicts.length, 0);
  });

  it('surfaces a move the server has made illegal', () => {
    // The order was refunded from HQ while this tablet was offline.
    const result = reconcileQueue([t('a', 'ready')], new Map([['a', 'refunded']] as const));
    assert.equal(result.apply.length, 0);
    assert.deepEqual(result.conflicts[0].serverStatus, 'refunded');
  });

  it('flags an order the server no longer knows', () => {
    const result = reconcileQueue([t('ghost', 'ready')], new Map());
    assert.equal(result.conflicts[0].serverStatus, null);
  });
});
