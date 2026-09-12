import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionDismissed,
  actionFailed,
  actionStarted,
  actionSucceeded,
  isActionPending,
  idleActionRequest,
} from './action-request-state';

test('starts idle', () => {
  assert.deepEqual(idleActionRequest, { phase: 'idle' });
  assert.equal(isActionPending(idleActionRequest), false);
});

test('starting an action moves it to pending and marks it pending', () => {
  const pending = actionStarted('refund');
  assert.deepEqual(pending, { phase: 'pending', kind: 'refund' });
  assert.equal(isActionPending(pending), true);
});

test('a pending action that succeeds returns to idle', () => {
  const pending = actionStarted('cancel');
  const resolved = actionSucceeded();
  assert.equal(isActionPending(pending), true);
  assert.deepEqual(resolved, { phase: 'idle' });
  assert.equal(isActionPending(resolved), false);
});

test('a pending action that fails carries its kind and message, and is no longer pending', () => {
  const pending = actionStarted('refund');
  const failed = actionFailed(pending.phase === 'pending' ? pending.kind : 'refund', 'Square rejected the refund.');
  assert.deepEqual(failed, { phase: 'error', kind: 'refund', message: 'Square rejected the refund.' });
  assert.equal(isActionPending(failed), false);
});

test('dismissing an error returns to idle', () => {
  const failed = actionFailed('cancel', 'Order already moved.');
  assert.deepEqual(actionDismissed(), { phase: 'idle' });
  assert.equal(isActionPending(failed), false);
});
