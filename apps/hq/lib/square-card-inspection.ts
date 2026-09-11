import {
  cancelSquareOrder,
  cancelSquarePaymentByIdempotencyKey,
  decryptToken,
  getSquarePayment,
  loadTokenKey,
  retrieveSquareOrder,
  settledPaymentFee,
  type SquareConfig,
  type SquareOrderSnapshot,
} from '@platform/engine';

import type {
  CardExpiryEvidence, CardInspection, DueSquareCard,
} from './square-card-maintenance-types';

function paymentIdFromTenders(value: unknown): string | null {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return null;
  if (!Array.isArray(value) || value.length !== 1) throw new Error('Indeterminate Square tenders.');
  const tender = value[0];
  if (!tender || typeof tender !== 'object') throw new Error('Invalid Square tender.');
  const item = tender as Record<string, unknown>;
  if (item.type !== 'CARD') throw new Error('Unexpected Square tender type.');
  const paymentId = typeof item.payment_id === 'string' && item.payment_id ? item.payment_id : null;
  const tenderId = typeof item.id === 'string' && item.id ? item.id : null;
  if (paymentId && tenderId && paymentId !== tenderId) throw new Error('Conflicting Square tender ids.');
  if (!paymentId && !tenderId) throw new Error('Missing Square payment id.');
  return paymentId ?? tenderId;
}

function assertOrderIdentity(order: SquareOrderSnapshot | undefined, row: DueSquareCard): void {
  if (!order || order.id !== row.squareOrderId || order.location_id !== row.squareLocationId
    || !Number.isSafeInteger(order.version) || (order.version ?? -1) < 0) {
    throw new Error('Square order identity could not be confirmed.');
  }
}

async function canceledOrderEvidence(
  square: SquareConfig,
  token: string,
  row: DueSquareCard,
  order: SquareOrderSnapshot,
  paymentId: string | null,
  paymentState: 'FAILED' | 'CANCELED' | null,
): Promise<CardExpiryEvidence> {
  const squareOrderId = row.squareOrderId;
  if (!squareOrderId) throw new Error('Square card order identity is missing.');
  assertOrderIdentity(order, row);
  let canceled = order;
  if (order.state !== 'CANCELED') {
    if (order.state !== 'OPEN' && order.state !== 'DRAFT') {
      throw new Error('Square order cannot be safely cancelled.');
    }
    canceled = (await cancelSquareOrder(square, token, {
      squareOrderId,
      squareLocationId: row.squareLocationId ?? '',
      version: order.version as number,
      referenceId: row.orderId,
    })).order ?? {};
    assertOrderIdentity(canceled, row);
  }
  if (canceled.state !== 'CANCELED') throw new Error('Square order was not cancelled.');
  if (paymentIdFromTenders(canceled.tenders) !== paymentId) {
    throw new Error('Square cancellation tender mismatch.');
  }
  return {
    kind: 'unpaid', squareOrderId,
    providerOrderVersion: canceled.version as number, providerOrderState: 'CANCELED',
    squarePaymentId: paymentId, providerPaymentState: paymentState,
  };
}

/** Establish provider-terminal proof, or return an exact completed receipt. */
export async function inspectDueSquareCard(
  square: SquareConfig,
  row: DueSquareCard,
): Promise<CardInspection> {
  if (!row.valid || row.grossCents === null || row.expectedFeeCents === null) {
    throw new Error('Stale Square card claim.');
  }
  if (!row.squareLocationId || !row.accessTokenEncrypted) {
    throw new Error('Incomplete Square card claim.');
  }
  if (!row.squareOrderId) throw new Error('Square card order must be recovered first.');
  const token = decryptToken(row.accessTokenEncrypted, loadTokenKey());
  let ambiguityFenced = false;
  try {
    await cancelSquarePaymentByIdempotencyKey(square, token, row.orderId);
    ambiguityFenced = true;
  } catch { /* A completed payment can make cancellation fail; inspect it below. */ }
  const order = (await retrieveSquareOrder(square, token, row.squareOrderId)).order;
  assertOrderIdentity(order, row);
  const tenderPaymentId = paymentIdFromTenders(order?.tenders);
  if (row.squarePaymentId && tenderPaymentId && row.squarePaymentId !== tenderPaymentId) {
    throw new Error('Square payment mismatch.');
  }
  const paymentId = row.squarePaymentId ?? tenderPaymentId;
  if (!paymentId) {
    if (!ambiguityFenced) throw new Error('Square payment ambiguity remains.');
    return canceledOrderEvidence(square, token, row, order as SquareOrderSnapshot, null, null);
  }
  const payment = (await getSquarePayment(square, token, paymentId)).payment;
  if (payment?.id !== paymentId || payment.order_id !== row.squareOrderId
    || payment.location_id !== row.squareLocationId) {
    throw new Error('Square payment identity could not be confirmed.');
  }
  if (payment.status === 'COMPLETED') {
    const settled = settledPaymentFee(
      payment, paymentId, row.grossCents, row.expectedFeeCents, row.squareLocationId,
    );
    return { kind: 'payment', paymentId, feeCents: settled.feeCents };
  }
  if (payment.status !== 'FAILED' && payment.status !== 'CANCELED') {
    throw new Error('Square payment remains nonterminal.');
  }
  if (!ambiguityFenced) throw new Error('Square payment ambiguity remains.');
  return canceledOrderEvidence(
    square, token, row, order as SquareOrderSnapshot, paymentId, payment.status,
  );
}
