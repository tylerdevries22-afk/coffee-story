import assert from 'node:assert/strict';
import test from 'node:test';

import { SquareApiError } from '../square/client';

import { isDefinitiveSquareRejection, safeSquarePaymentError } from './provider-error';

test('only explicit non-retryable provider rejections release a payment claim', () => {
  assert.equal(isDefinitiveSquareRejection(new SquareApiError('declined', 402, {
    errors: [{ code: 'CARD_DECLINED' }],
  })), true);
  for (const status of [408, 409, 425, 429, 500, 503]) {
    assert.equal(isDefinitiveSquareRejection(new SquareApiError('retry', status, {})), false);
  }
  assert.equal(isDefinitiveSquareRejection(new SquareApiError('conflict', 400, {
    errors: [{ code: 'IDEMPOTENCY_KEY_REUSED' }],
  })), false);
  assert.equal(isDefinitiveSquareRejection(new TypeError('connection reset')), false);
});

test('customer errors do not expose provider response details', () => {
  const raw = new SquareApiError('Square POST /v2/payments -> 402', 402, {
    errors: [{ detail: 'sensitive-provider-detail' }],
  });
  const error = safeSquarePaymentError(raw);
  assert.equal(error.code, 'payment_unavailable');
  assert.doesNotMatch(error.message, /Square|402|sensitive-provider-detail/u);
});
