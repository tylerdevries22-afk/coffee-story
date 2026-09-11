import { SquareApiError } from '../square/client';

import { OrderError } from './types';

/** A request-shape conflict can be evidence that an earlier response was lost. */
export function isDefinitiveSquareRejection(error: unknown): error is SquareApiError {
  if (!(error instanceof SquareApiError) || error.status < 400 || error.status >= 500
    || [408, 409, 425, 429].includes(error.status)) return false;
  const detail = JSON.stringify(error.body).toLowerCase();
  return !detail.includes('idempotency_key_reused')
    && !(/idempotency.{0,80}(reused|different request|same key)/u.test(detail));
}

/** Convert provider and transport details into a retry-safe customer message. */
export function safeSquarePaymentError(
  error: unknown,
  definitiveRetry: 'same_order' | 'new_order' = 'same_order',
): OrderError {
  return new OrderError(
    'payment_unavailable',
    isDefinitiveSquareRejection(error)
      ? definitiveRetry === 'new_order'
        ? 'Card payment was rejected. Place a new order to try another card.'
        : 'Card payment was rejected. Check your card details before retrying this order.'
      : 'Card payment could not be confirmed. Retry this order; the same payment reference will be reused.',
  );
}
