import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestSequence } from './request-sequence';

test('only the newest request remains current', () => {
  const sequence = createRequestSequence();
  const first = sequence.begin();
  const second = sequence.begin();

  assert.equal(sequence.isCurrent(first), false);
  assert.equal(sequence.isCurrent(second), true);
});

test('invalidation makes an in-flight request stale', () => {
  const sequence = createRequestSequence();
  const request = sequence.begin();

  sequence.invalidate();

  assert.equal(sequence.isCurrent(request), false);
});

test('a later request can become current after invalidation', () => {
  const sequence = createRequestSequence();
  sequence.begin();
  sequence.invalidate();
  const request = sequence.begin();

  assert.equal(sequence.isCurrent(request), true);
});
