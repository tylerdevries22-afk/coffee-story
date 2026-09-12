import assert from 'node:assert/strict';
import test from 'node:test';

import { appendConflict, appendConflicts, dismissConflict } from './operator-conflicts';

test('appendConflict adds one entry with a unique, stable id', () => {
  const first = appendConflict([], 'order-1', 'Refund rejected.');
  assert.equal(first.length, 1);
  assert.equal(first[0]?.orderId, 'order-1');
  assert.equal(first[0]?.message, 'Refund rejected.');
  assert.ok(first[0]?.id);

  const second = appendConflict(first, 'order-2', 'Cancel rejected.');
  assert.equal(second.length, 2);
  assert.notEqual(second[0]?.id, second[1]?.id);
  // The first entry is untouched by the second append.
  assert.deepEqual(second[0], first[0]);
});

test('appendConflicts assigns a distinct id to every batched entry', () => {
  const batch = appendConflicts([], [
    { orderId: 'a', message: 'Order moved elsewhere.' },
    { orderId: 'b', message: 'Order no longer exists.' },
  ]);
  assert.equal(batch.length, 2);
  assert.notEqual(batch[0]?.id, batch[1]?.id);
  assert.equal(batch[0]?.orderId, 'a');
  assert.equal(batch[1]?.orderId, 'b');
});

test('dismissConflict removes only the matching id', () => {
  const seeded = appendConflicts([], [
    { orderId: 'a', message: 'first' },
    { orderId: 'a', message: 'second' },
  ]);
  const [keep, drop] = seeded;
  assert.ok(keep && drop);
  const remaining = dismissConflict(seeded, drop.id);
  assert.deepEqual(remaining, [keep]);
});

test('dismissConflict is a no-op for an unknown id', () => {
  const seeded = appendConflict([], 'order-1', 'message');
  const remaining = dismissConflict(seeded, 'not-a-real-id');
  assert.deepEqual(remaining, seeded);
});
