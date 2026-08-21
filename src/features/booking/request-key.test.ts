import assert from 'node:assert/strict';
import { test } from 'node:test';

import { requestKey } from './request-key';

test('request keys preserve the scope and use the allowed separator set', () => {
  const key = requestKey('appointment-review', () => 1700000000000, () => 0.123456);
  assert.equal(key, 'appointment-review-1700000000000-4fzyo82m');
  assert.match(key, /^[A-Za-z0-9._:/-]+$/);
});

test('request keys are deterministic when their clock and random sources are fixed', () => {
  assert.equal(requestKey('demo', () => 42, () => 0.5), requestKey('demo', () => 42, () => 0.5));
});
