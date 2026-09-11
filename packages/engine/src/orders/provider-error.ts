import { SquareApiError } from '../square/client';

/** A request-shape conflict can be evidence that an earlier response was lost. */
export function isDefinitiveSquareRejection(error: unknown): error is SquareApiError {
  if (!(error instanceof SquareApiError) || error.status < 400 || error.status >= 500
    || [408, 409, 425, 429].includes(error.status)) return false;
  const detail = JSON.stringify(error.body).toLowerCase();
  return !detail.includes('idempotency_key_reused')
    && !(/idempotency.{0,80}(reused|different request|same key)/u.test(detail));
}
