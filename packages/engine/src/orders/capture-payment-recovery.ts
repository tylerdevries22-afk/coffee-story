import { getSquarePayment, retrieveSquareOrder } from '../square/client';
import { settledPaymentFee } from '../square/payment-receipt';

import type { CapturePaymentDeps } from './capture-payment';
import {
  getSquarePaymentQuote, recordReconciledSquarePayment,
} from './platform-fee-bindings';
import { OrderError } from './types';

export type BoundPaymentOrder = {
  id: string;
  status: string;
  total_cents: number;
  stored_value_applied_cents: number;
  square_order_id: string | null;
  square_payment_id: string;
};

function cardTenderPaymentId(tenders: unknown): string | null {
  if (Array.isArray(tenders) && tenders.length === 0) return null;
  if (!Array.isArray(tenders) || tenders.length !== 1) {
    throw new Error('Indeterminate provider tender state.');
  }
  const tender = tenders[0];
  if (!tender || typeof tender !== 'object') throw new Error('Invalid provider tender.');
  const row = tender as Record<string, unknown>;
  if (row.type !== 'CARD') throw new Error('Unexpected provider tender.');
  const paymentId = typeof row.payment_id === 'string' && row.payment_id ? row.payment_id : null;
  const tenderId = typeof row.id === 'string' && row.id ? row.id : null;
  if (paymentId && tenderId && paymentId !== tenderId) throw new Error('Conflicting payment identity.');
  if (!paymentId && !tenderId) throw new Error('Missing payment identity.');
  return paymentId ?? tenderId;
}

/** Check a prebound provider order before a retry sends card data again. */
export async function recoverPreboundSquareOrder(
  deps: CapturePaymentDeps,
  order: Omit<BoundPaymentOrder, 'square_payment_id'> & { square_payment_id: null },
): Promise<{ orderId: string; squarePaymentId: string } | null> {
  let providerOrder;
  try {
    providerOrder = (await retrieveSquareOrder(
      deps.square, deps.locationAccessToken, order.square_order_id ?? '',
    )).order;
  } catch {
    throw new OrderError('payment_unavailable',
      'Card payment could not be confirmed. Retry this order; the same payment reference will be reused.');
  }
  if (!order.square_order_id || providerOrder?.id !== order.square_order_id) {
    throw new OrderError('payment_unavailable', 'Card payment identity could not be confirmed.');
  }
  let paymentId;
  try { paymentId = cardTenderPaymentId(providerOrder.tenders); }
  catch { throw new OrderError('payment_unavailable', 'Card payment identity could not be confirmed.'); }
  if (!paymentId) {
    if (providerOrder.state !== 'OPEN') {
      throw new OrderError('payment_unavailable', 'Card payment state could not be confirmed.');
    }
    return null;
  }
  return recoverProviderPayment(deps, order, paymentId);
}

async function recoverProviderPayment(
  deps: CapturePaymentDeps,
  order: Omit<BoundPaymentOrder, 'square_payment_id'>,
  paymentId: string,
): Promise<{ orderId: string; squarePaymentId: string }> {
  return recoverBoundSquarePayment(deps, { ...order, square_payment_id: paymentId });
}

/** Repair local settlement after a provider or database response was lost. */
export async function recoverBoundSquarePayment(
  deps: CapturePaymentDeps,
  order: BoundPaymentOrder,
): Promise<{ orderId: string; squarePaymentId: string }> {
  const grossCents = order.total_cents - order.stored_value_applied_cents;
  let quote;
  try {
    quote = await getSquarePaymentQuote(deps.db, {
      orderId: order.id, squareOrderId: order.square_order_id ?? '',
    });
  } catch {
    throw new OrderError('payment_unavailable',
      'Card payment pricing could not be confirmed. Retry this order.');
  }
  if (quote.grossCents !== grossCents) {
    throw new OrderError('payment_unavailable', 'Card payment pricing could not be confirmed.');
  }
  let receipt;
  try {
    receipt = await getSquarePayment(
      deps.square,
      deps.locationAccessToken,
      order.square_payment_id,
    );
  } catch {
    throw new OrderError('payment_unavailable',
      'Card payment could not be confirmed. Retry this order; the same payment reference will be reused.');
  }
  if (!order.square_order_id || receipt.payment?.order_id !== order.square_order_id) {
    throw new OrderError('payment_unavailable', 'Card payment identity could not be confirmed.');
  }
  let fee;
  try {
    fee = settledPaymentFee(
      receipt.payment, order.square_payment_id, grossCents,
      quote.feeCents, deps.squareLocationId,
    );
  } catch {
    throw new OrderError('payment_unavailable', 'Card payment settlement could not be confirmed.');
  }
  try {
    await recordReconciledSquarePayment(deps.db, {
      orderId: order.id,
      squareOrderId: order.square_order_id,
      squarePaymentId: order.square_payment_id,
      settledFeeCents: fee.feeCents,
    });
  } catch {
    throw new OrderError('payment_unavailable',
      'Card payment was confirmed but local settlement is still pending. Retry this order.');
  }
  return { orderId: order.id, squarePaymentId: order.square_payment_id };
}
