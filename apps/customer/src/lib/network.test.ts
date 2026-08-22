import assert from 'node:assert/strict';
import test from 'node:test';

import { requestCanRetry } from './network';

test('safe reads are retryable', () => {
  assert.equal(requestCanRetry(), true);
  assert.equal(requestCanRetry({ method: 'HEAD' }), true);
});

test('writes require an idempotency key before retrying', () => {
  assert.equal(requestCanRetry({ method: 'POST' }), false);
  assert.equal(requestCanRetry({
    method: 'POST',
    headers: { 'Idempotency-Key': 'booking-user-request' },
  }), true);
});
