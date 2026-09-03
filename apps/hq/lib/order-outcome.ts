/**
 * How a finished placement becomes an HTTP answer: the status each engine
 * error code carries, and the wire response shaped from the result.
 *
 * The table is a contract with the clients -- they branch on the code, and
 * the status decides whether their retry logic runs at all -- so it is worth
 * reading on its own rather than scrolling past the handler that uses it.
 */
import type { PlaceOrderResponse } from '@platform/api-client';
import type { CreateOrderResult, OrderError } from '@platform/engine';

import { jsonError } from './api-auth';

const ERROR_STATUS: Record<OrderError['code'], number> = {
  invalid_request: 400,
  quantity_invalid: 400,
  size_required: 400,
  size_unknown: 400,
  modifier_unknown: 400,
  modifier_invalid: 400,
  catalog_invalid: 500,
  location_unknown: 404,
  ordering_paused: 409,
  idempotency_conflict: 409,
  price_changed: 409,
  item_unavailable: 409,
  refund_unavailable: 409,
  cancel_unavailable: 409,
};

export function orderErrorResponse(error: OrderError): Response {
  return jsonError(ERROR_STATUS[error.code], error.code, error.message);
}

/**
 * `checkoutUrl` is deliberately absent: it exists only once the hosted page
 * has been minted, which happens after the order is priced and written.
 */
export function placeOrderResponseOf(result: CreateOrderResult): PlaceOrderResponse {
  return {
    orderId: result.orderId,
    status: result.status as PlaceOrderResponse['status'],
    subtotalCents: result.subtotalCents,
    taxCents: result.taxCents,
    tipCents: result.tipCents,
    totalCents: result.totalCents,
    dailyNumber: result.dailyNumber,
  };
}
