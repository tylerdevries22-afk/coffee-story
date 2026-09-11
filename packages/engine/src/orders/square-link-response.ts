import type { SquarePaymentLinkResponse } from '../square/client';
import { squareUsdCents } from '../square/payment-receipt';

export type SquareCheckoutIdentity = {
  checkoutUrl: string;
  paymentLinkId: string;
  squareOrderId: string;
};

/** Require the checkout page and its calculated Order to match the local charge. */
export function exactSquareCheckoutIdentity(
  response: SquarePaymentLinkResponse,
  expected: { amountCents: number; squareLocationId: string; referenceId: string },
): SquareCheckoutIdentity {
  const checkoutUrl = response.payment_link?.url;
  const paymentLinkId = response.payment_link?.id;
  const squareOrderId = response.payment_link?.order_id;
  const orders = response.related_resources?.orders;
  const order = Array.isArray(orders) && squareOrderId
    ? orders.find((candidate) => candidate.id === squareOrderId)
    : undefined;
  if (!checkoutUrl || !paymentLinkId || !squareOrderId || !order
    || order.location_id !== expected.squareLocationId
    || order.reference_id !== expected.referenceId
    || squareUsdCents(order.total_money) !== expected.amountCents) {
    throw new Error('Square checkout identity or total is invalid.');
  }
  return { checkoutUrl, paymentLinkId, squareOrderId };
}
